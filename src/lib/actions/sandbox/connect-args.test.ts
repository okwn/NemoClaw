// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSandboxConnectFlag,
  parseSandboxConnectArgs,
  printSandboxConnectHelp,
} from "../../../../dist/lib/actions/sandbox/connect";

describe("sandbox connect argument helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockExit() {
    return vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit);
  }

  it("recognizes supported connect flags", () => {
    expect(isSandboxConnectFlag("--probe-only")).toBe(true);
    expect(isSandboxConnectFlag("--help")).toBe(true);
    expect(isSandboxConnectFlag("-h")).toBe(true);
    expect(isSandboxConnectFlag("--dangerously-skip-permissions")).toBe(true);
    expect(isSandboxConnectFlag("--unknown")).toBe(false);
    expect(isSandboxConnectFlag(undefined)).toBe(false);
  });

  it("parses probe-only options", () => {
    expect(parseSandboxConnectArgs("alpha", ["--probe-only"])).toEqual({ probeOnly: true });
    expect(parseSandboxConnectArgs("alpha", [])).toEqual({});
  });

  it("prints help with the sandbox-scoped usage", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    printSandboxConnectHelp("alpha");
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "nemoclaw alpha connect [--probe-only]",
    );
  });

  it("exits after printing help flags", () => {
    mockExit();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => parseSandboxConnectArgs("alpha", ["--help"])).toThrow("exit:0");
    expect(() => parseSandboxConnectArgs("alpha", ["-h"])).toThrow("exit:0");
  });

  it("rejects unknown and removed flags", () => {
    mockExit();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(() => parseSandboxConnectArgs("alpha", ["--bad"])).toThrow("exit:1");
    expect(error.mock.calls.flat().join("\n")).toContain("Unknown flag for connect: --bad");

    expect(() =>
      parseSandboxConnectArgs("alpha", ["--dangerously-skip-permissions"]),
    ).toThrow("exit:1");
    expect(error.mock.calls.flat().join("\n")).toContain(
      "--dangerously-skip-permissions was removed",
    );
  });
});
