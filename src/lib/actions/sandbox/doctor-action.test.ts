// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const getSandbox = vi.fn();

let runSandboxDoctor: typeof import("../../../../dist/lib/actions/sandbox/doctor").runSandboxDoctor;

function loadDoctorAction(): void {
  const mocks = {
    "../../../../dist/lib/adapters/openshell/resolve": { resolveOpenshell: () => null },
    "../../../../dist/lib/gateway-runtime-action": { recoverNamedGatewayRuntime: vi.fn() },
    "../../../../dist/lib/state/registry": { getSandbox },
    "../../../../dist/lib/tunnel/services": { readCloudflaredState: () => ({ kind: "stopped" }) },
  };
  for (const [id, exports] of Object.entries(mocks)) {
    const resolved = require.resolve(id);
    delete require.cache[resolved];
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] } as unknown as NodeJS.Module;
  }
  const actionPath = require.resolve("../../../../dist/lib/actions/sandbox/doctor");
  delete require.cache[actionPath];
  ({ runSandboxDoctor } = require(actionPath));
}

describe("sandbox doctor action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSandbox.mockReturnValue(null);
    loadDoctorAction();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockExit() {
    return vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);
  }

  it("prints usage for help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runSandboxDoctor("alpha", ["--help"]);
    expect(log.mock.calls.flat().join("\n")).toContain("nemoclaw <name> doctor [--json]");
  });

  it("rejects unknown arguments", async () => {
    mockExit();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runSandboxDoctor("alpha", ["--bad", "extra"])).rejects.toThrow("exit:1");
    expect(error.mock.calls.flat().join("\n")).toContain("Unknown doctor arguments: --bad extra");
  });

  it("emits JSON diagnostics and exits nonzero when host checks fail", async () => {
    mockExit();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runSandboxDoctor("alpha", ["--json"])).rejects.toThrow(/exit:/);

    const payload = JSON.parse(log.mock.calls.at(-1)?.[0] as string);
    expect(payload).toMatchObject({ schemaVersion: 1, sandbox: "alpha" });
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks.map((check: { label: string }) => check.label)).toContain("CLI build");
    expect(payload.checks.map((check: { label: string }) => check.label)).toContain("Docker daemon");
    expect(payload.checks.map((check: { label: string }) => check.label)).toContain("cloudflared");
  });
});
