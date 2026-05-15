// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const runOpenshell = vi.fn();

let showSandboxLogs: typeof import("../../../../dist/lib/actions/sandbox/logs").showSandboxLogs;

function loadLogsAction(): void {
  const runtimePath = require.resolve("../../../../dist/lib/adapters/openshell/runtime");
  const actionPath = require.resolve("../../../../dist/lib/actions/sandbox/logs");
  delete require.cache[runtimePath];
  delete require.cache[actionPath];
  require.cache[runtimePath] = {
    id: runtimePath,
    filename: runtimePath,
    loaded: true,
    exports: { getOpenshellBinary: () => "openshell", runOpenshell },
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
  ({ showSandboxLogs } = require(actionPath));
}

describe("sandbox logs action", () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.resetAllMocks();
    runOpenshell.mockReturnValue({ status: 0, stdout: "", stderr: "", signal: null });
    vi.spyOn(console, "error").mockImplementation((message?: unknown) => errors.push(String(message ?? "")));
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);
    loadLogsAction();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enables audit logs, probes OpenClaw logs, and then runs OpenShell logs", () => {
    expect(() => showSandboxLogs("alpha", false)).toThrow("exit:0");
    expect(runOpenshell.mock.calls.map((call) => call[0])).toEqual([
      ["settings", "set", "alpha", "--key", "ocsf_json_enabled", "--value", "true"],
      ["sandbox", "exec", "-n", "alpha", "--", "tail", "-n", "200", "/tmp/gateway.log"],
      ["logs", "alpha", "-n", "200", "--source", "all"],
    ]);
  });

  it("skips OpenClaw log probing for since-filtered logs", () => {
    expect(() => showSandboxLogs("alpha", { since: "10m", follow: false, lines: "200" })).toThrow("exit:0");
    expect(runOpenshell.mock.calls.map((call) => call[0])).toEqual([
      ["settings", "set", "alpha", "--key", "ocsf_json_enabled", "--value", "true"],
      ["logs", "alpha", "-n", "200", "--source", "all", "--since", "10m"],
    ]);
  });

  it("warns when audit and OpenClaw log probes fail", () => {
    runOpenshell
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "audit denied", signal: null })
      .mockReturnValueOnce({ status: 124, stdout: "", stderr: "", signal: null })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "", signal: null });

    expect(() => showSandboxLogs("alpha", false)).toThrow("exit:0");

    const output = errors.join("\n");
    expect(output).toContain("failed to enable OpenShell audit logs");
    expect(output).toContain("audit denied");
    expect(output).toContain("OpenClaw log source unavailable");
  });

  it("exits with the OpenShell logs command status", () => {
    runOpenshell
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "", signal: null })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "", signal: null })
      .mockReturnValueOnce({ status: 7, stdout: "", stderr: "", signal: null });

    expect(() => showSandboxLogs("alpha", false)).toThrow("exit:7");
    expect(errors.join("\n")).toContain("Command failed (exit 7)");
  });
});
