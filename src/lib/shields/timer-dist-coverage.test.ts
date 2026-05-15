// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn(() => ({ status: 0 }));
const lockAgentConfigMock = vi.fn();
const appendAuditEntryMock = vi.fn();
const resolveAgentConfigMock = vi.fn(() => ({
  configPath: "/sandbox/.openclaw/openclaw.json",
  configDir: "/sandbox/.openclaw",
}));
const defaultAgentConfig = { configPath: "/sandbox/.openclaw/openclaw.json", configDir: "/sandbox/.openclaw" };
const originalLoad = (Module as unknown as { _load: unknown })._load as (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

type TimerModule = typeof import("../../../dist/lib/shields/timer.js");

let tmpHome: string;
let timer: TimerModule;

function stateDir(): string {
  return path.join(tmpHome, ".nemoclaw", "state");
}

function invokeTimer(args: NonNullable<ReturnType<TimerModule["parseTimerArgs"]>>): number {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`exit:${String(code ?? 0)}`);
  });
  try {
    timer.runRestoreTimer(args);
    throw new Error("expected exit");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message.startsWith("exit:")).toBe(true);
    return Number.parseInt(message.slice("exit:".length), 10);
  } finally {
    exitSpy.mockRestore();
  }
}

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "shields-timer-dist-"));
  vi.stubEnv("HOME", tmpHome);
  vi.resetModules();
  vi.clearAllMocks();
  (Module as unknown as { _load: typeof originalLoad })._load = (request, parent, isMain) => {
    if (request === "../runner") return { run: runMock };
    if (request === "../policy") {
      return { buildPolicySetCommand: (file: string, name: string) => ["policy", "set", file, name] };
    }
    if (request === "../sandbox/config") {
      return {
        DEFAULT_AGENT_CONFIG: defaultAgentConfig,
        resolveAgentConfig: resolveAgentConfigMock,
      };
    }
    if (request === "./index") return { lockAgentConfig: lockAgentConfigMock };
    if (request === "./audit") return { appendAuditEntry: appendAuditEntryMock };
    return originalLoad(request, parent, isMain);
  };
  timer = await import("../../../dist/lib/shields/timer.js");
});

afterEach(() => {
  (Module as unknown as { _load: typeof originalLoad })._load = originalLoad;
  vi.unstubAllEnvs();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("dist shields timer coverage", () => {
  it("parses valid and invalid timer arguments", () => {
    expect(timer.parseTimerArgs([])).toBeNull();
    expect(timer.parseTimerArgs(["alpha", "/tmp/snapshot.yaml", "not-a-date"])).toBeNull();

    const restoreAtIso = new Date(Date.now() + 60_000).toISOString();
    const args = timer.parseTimerArgs(["alpha", "/tmp/snapshot.yaml", restoreAtIso, "/cfg.json", "/cfg", "tok"]);
    expect(args).toMatchObject({ sandboxName: "alpha", snapshotPath: "/tmp/snapshot.yaml", restoreAtIso });
    expect(args?.delayMs).toBeGreaterThanOrEqual(0);
  });

  it("does not restore when marker is missing", () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    const snapshot = path.join(stateDir(), "snapshot.yaml");
    const restoreAtIso = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(snapshot, "version: 1\n");
    const args = timer.parseTimerArgs(["alpha", snapshot, restoreAtIso, "/cfg.json", "/cfg", "tok"]);
    expect(args).not.toBeNull();

    expect(invokeTimer(args!)).toBe(0);
    expect(runMock).not.toHaveBeenCalled();
    expect(lockAgentConfigMock).not.toHaveBeenCalled();
  });

  it("restores policy, locks config, updates state, and removes owned marker", () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    const sandboxName = "alpha";
    const snapshot = path.join(stateDir(), "snapshot.yaml");
    const restoreAtIso = new Date(Date.now() + 60_000).toISOString();
    const markerPath = path.join(stateDir(), `shields-timer-${sandboxName}.json`);
    const stateFile = path.join(stateDir(), `shields-${sandboxName}.json`);
    fs.writeFileSync(snapshot, "version: 1\n");
    fs.writeFileSync(stateFile, JSON.stringify({ shieldsDown: true }));
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ pid: process.pid, sandboxName, snapshotPath: snapshot, restoreAt: restoreAtIso, processToken: "tok" }),
    );
    const args = timer.parseTimerArgs([sandboxName, snapshot, restoreAtIso, "/cfg.json", "/cfg", "tok"]);
    expect(args).not.toBeNull();

    expect(invokeTimer(args!)).toBe(0);
    expect(runMock).toHaveBeenCalledWith(["policy", "set", snapshot, sandboxName], { ignoreError: true });
    expect(lockAgentConfigMock).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(stateFile, "utf-8"))).toMatchObject({ shieldsDown: false });
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("keeps shields down and audits when policy restore fails", () => {
    runMock.mockReturnValueOnce({ status: 42 });
    fs.mkdirSync(stateDir(), { recursive: true });
    const sandboxName = "alpha";
    const snapshot = path.join(stateDir(), "snapshot.yaml");
    const restoreAtIso = new Date(Date.now() + 60_000).toISOString();
    const markerPath = path.join(stateDir(), `shields-timer-${sandboxName}.json`);
    const stateFile = path.join(stateDir(), `shields-${sandboxName}.json`);
    fs.writeFileSync(snapshot, "version: 1\n");
    fs.writeFileSync(stateFile, JSON.stringify({ shieldsDown: true }));
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ pid: process.pid, sandboxName, snapshotPath: snapshot, restoreAt: restoreAtIso, processToken: "tok" }),
    );
    const args = timer.parseTimerArgs([sandboxName, snapshot, restoreAtIso, "/cfg.json", "/cfg", "tok"]);

    expect(invokeTimer(args!)).toBe(1);
    expect(appendAuditEntryMock).toHaveBeenCalledWith(expect.objectContaining({ action: "shields_up_failed" }));
    expect(lockAgentConfigMock).not.toHaveBeenCalled();
  });
});
