// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const getReconciledSandboxGatewayState = vi.fn();
const getSandboxGatewayStateForStatus = vi.fn();
const printGatewayLifecycleHint = vi.fn();
const printWrongGatewayActiveGuidance = vi.fn();
const getNamedGatewayLifecycleState = vi.fn();
const captureOpenshellForStatus = vi.fn();
const getSandbox = vi.fn();
const removeSandbox = vi.fn();
const loadSession = vi.fn();
const updateSession = vi.fn();
const isSandboxGatewayRunningForStatus = vi.fn();
const probeProviderHealth = vi.fn();

let showSandboxStatus: typeof import("../../../../dist/lib/actions/sandbox/status").showSandboxStatus;

function loadStatusAction(): void {
  const mocks = {
    "../../../../dist/lib/actions/sandbox/gateway-state": {
      getReconciledSandboxGatewayState,
      getSandboxGatewayStateForStatus,
      printGatewayLifecycleHint,
      printWrongGatewayActiveGuidance,
    },
    "../../../../dist/lib/gateway-runtime-action": { getNamedGatewayLifecycleState },
    "../../../../dist/lib/adapters/openshell/runtime": {
      captureOpenshellForStatus,
      isCommandTimeout: () => false,
    },
    "../../../../dist/lib/state/registry": { getSandbox, removeSandbox },
    "../../../../dist/lib/state/onboard-session": { loadSession, updateSession },
    "../../../../dist/lib/actions/sandbox/process-recovery": {
      isSandboxGatewayRunningForStatus,
      probeSandboxInferenceGatewayHealth: vi.fn(),
    },
    "../../../../dist/lib/inference/health": { probeProviderHealth },
    "../../../../dist/lib/inference/nim": {
      nimStatusByName: () => ({ running: false, healthy: false, container: "nim" }),
      nimStatus: () => ({ running: false, healthy: false, container: "nim" }),
      shouldShowNimLine: () => false,
    },
    "../../../../dist/lib/sandbox/version": {
      checkAgentVersion: () => ({ sandboxVersion: "1.0.0", expectedVersion: "1.0.0", isStale: false }),
    },
    "../../../../dist/lib/shields": { isShieldsDown: () => false },
    "../../../../dist/lib/adapters/openshell/resolve": { resolveOpenshell: () => null },
    "../../../../dist/lib/state/sandbox-session": {
      createSystemDeps: () => ({}),
      getActiveSandboxSessions: () => ({ detected: false, sessions: [] }),
    },
  };
  for (const [id, exports] of Object.entries(mocks)) {
    const resolved = require.resolve(id);
    delete require.cache[resolved];
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] } as unknown as NodeJS.Module;
  }
  const actionPath = require.resolve("../../../../dist/lib/actions/sandbox/status");
  delete require.cache[actionPath];
  ({ showSandboxStatus } = require(actionPath));
}

describe("sandbox status action", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => logs.push(String(message ?? "")));
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);
    getSandbox.mockReturnValue({
      name: "alpha",
      model: "m",
      provider: "openai",
      policies: ["github"],
      hostGpuDetected: false,
      sandboxGpuEnabled: false,
      openshellDriver: "docker",
      openshellVersion: "0.0.1",
    });
    captureOpenshellForStatus.mockResolvedValue({ status: 0, output: "Provider: openai\nModel: live-model\n" });
    isSandboxGatewayRunningForStatus.mockResolvedValue(true);
    probeProviderHealth.mockReturnValue({ ok: true, probed: true, endpoint: "https://example", detail: "ok" });
    loadStatusAction();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints present sandbox status and process health", async () => {
    getReconciledSandboxGatewayState.mockResolvedValue({ state: "present", output: "alpha Ready" });
    await showSandboxStatus("alpha");
    const output = logs.join("\n");
    expect(output).toContain("Sandbox: alpha");
    expect(output).toContain("Provider: openai");
    expect(output).toContain("healthy");
    expect(output).toContain("running");
  });

  it("removes stale local registry entries when the named gateway is healthy", async () => {
    getReconciledSandboxGatewayState.mockResolvedValue({ state: "missing", output: "missing" });
    getNamedGatewayLifecycleState.mockReturnValue({ state: "healthy_named" });
    loadSession.mockReturnValue({ sandboxName: "alpha" });

    await expect(showSandboxStatus("alpha")).rejects.toThrow("exit:1");

    expect(removeSandbox).toHaveBeenCalledWith("alpha");
    expect(updateSession).toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Removed stale local registry entry");
  });

  it("prints wrong-gateway guidance", async () => {
    getReconciledSandboxGatewayState.mockResolvedValue({ state: "wrong_gateway_active", activeGateway: "other" });
    printWrongGatewayActiveGuidance.mockImplementation((sandbox, gateway, log) => log(`${sandbox}:${gateway}`));

    await expect(showSandboxStatus("alpha")).rejects.toThrow("exit:1");

    expect(logs.join("\n")).toContain("alpha:other");
  });
});
