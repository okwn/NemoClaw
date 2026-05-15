// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dockerExecFileSyncMock = vi.fn((argv: string[]): string => {
  const command = argv.join(" ");
  if (command.includes("stat -c %a %U:%G")) {
    if (command.includes(".openclaw/openclaw.json") || command.includes(".openclaw/.env")) {
      return "444 root:root";
    }
    return "755 root:root";
  }
  if (command.includes("lsattr -d")) return "----i--------e------- /sandbox/.openclaw/openclaw.json";
  return "";
});
const dockerCaptureMock = vi.fn(() => "openshell-alpha-1\nother\n");
const validateNameMock = vi.fn((name: string) => name);
const appendAuditEntryMock = vi.fn();

const runnerMock = () => ({
  run: vi.fn(() => ({ status: 0 })),
  runCapture: vi.fn(() => "version: 1\nnetwork_policies: {}\n"),
  validateName: validateNameMock,
  shellQuote: vi.fn((value: string) => `'${value}'`),
});

const dockerExecMock = () => ({ dockerExecFileSync: dockerExecFileSyncMock });
const dockerRunMock = () => ({ dockerCapture: dockerCaptureMock });
const registryMock = () => ({
  getSandbox: vi.fn((name: string) => (name === "alpha" ? { openshellDriver: "docker" } : null)),
});
const policyMock = () => ({
  buildPolicyGetCommand: vi.fn((name: string) => ["openshell", "policy", "get", name]),
  buildPolicySetCommand: vi.fn((file: string, name: string) => ["openshell", "policy", "set", file, name]),
  parseCurrentPolicy: vi.fn((raw: string) => raw),
  resolvePermissivePolicyPath: vi.fn(() => "/tmp/permissive.yaml"),
});
const timerControlMock = () => ({
  timerMarkerPath: vi.fn((name: string) => `/tmp/shields-timer-${name}.json`),
  readTimerMarker: vi.fn(() => null),
  clearTimerMarker: vi.fn(),
  isProcessAlive: vi.fn(() => false),
  verifyTimerMarkerIdentity: vi.fn(() => false),
  killTimer: vi.fn(),
});
const auditMock = () => ({ appendAuditEntry: appendAuditEntryMock });
const sandboxConfigMock = () => ({
  resolveAgentConfig: vi.fn(() => ({
    agentName: "openclaw",
    configPath: "/sandbox/.openclaw/openclaw.json",
    configDir: "/sandbox/.openclaw",
    sensitiveFiles: ["/sandbox/.openclaw/.env"],
  })),
});

type ShieldsModule = typeof import("../../../dist/lib/shields/index.js");

let tmpHome: string;
let shields: ShieldsModule;
const originalLoad = (Module as unknown as { _load: unknown })._load as (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

function stateDir(): string {
  return path.join(tmpHome, ".nemoclaw", "state");
}

function writeState(sandboxName: string, state: Record<string, unknown> | string): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(
    path.join(stateDir(), `shields-${sandboxName}.json`),
    typeof state === "string" ? state : JSON.stringify(state, null, 2),
  );
}

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "shields-dist-"));
  vi.stubEnv("HOME", tmpHome);
  vi.resetModules();
  vi.clearAllMocks();
  (Module as unknown as { _load: typeof originalLoad })._load = (request, parent, isMain) => {
    if (request === "../runner") return runnerMock();
    if (request === "../adapters/docker/exec") return dockerExecMock();
    if (request === "../adapters/docker/run") return dockerRunMock();
    if (request === "../state/registry") return registryMock();
    if (request === "../policy") return policyMock();
    if (request === "./timer-control") return timerControlMock();
    if (request === "./audit") return auditMock();
    if (request === "../sandbox/config") return sandboxConfigMock();
    return originalLoad(request, parent, isMain);
  };
  shields = await import("../../../dist/lib/shields/index.js");
});

afterEach(() => {
  (Module as unknown as { _load: typeof originalLoad })._load = originalLoad;
  vi.unstubAllEnvs();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("dist shields coverage", () => {
  it("derives all persisted shields modes", () => {
    expect(shields.deriveShieldsMode({}, false)).toBe("mutable_default");
    expect(shields.deriveShieldsMode({}, true)).toBe("mutable_default");
    expect(shields.deriveShieldsMode({ shieldsDown: true }, true)).toBe("temporarily_unlocked");
    expect(shields.deriveShieldsMode({ shieldsDown: false }, true)).toBe("locked");
  });

  it("reports default, locked, down, and corrupt states", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`exit:${String(code ?? 0)}`);
    });

    shields.shieldsStatus("fresh", false);
    expect(log.mock.calls.flat().join("\n")).toContain("NOT CONFIGURED");

    writeState("locked", { shieldsDown: false, shieldsPolicySnapshotPath: "/tmp/snapshot.yaml" });
    shields.shieldsStatus("locked", false);
    expect(log.mock.calls.flat().join("\n")).toContain("UP (lockdown active)");

    writeState("down", {
      shieldsDown: true,
      shieldsDownAt: new Date().toISOString(),
      shieldsDownTimeout: 300,
      shieldsDownReason: "test",
      shieldsDownPolicy: "permissive",
    });
    shields.shieldsStatus("down", false);
    expect(log.mock.calls.flat().join("\n")).toContain("DOWN (temporarily unlocked)");

    writeState("corrupt", "not json");
    expect(() => shields.shieldsStatus("corrupt", false)).toThrow("exit:1");
    expect(error.mock.calls.flat().join("\n")).toContain("state file is corrupt");

    exit.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });

  it("answers whether shields are down from persisted state", () => {
    expect(shields.isShieldsDown("fresh", false)).toBe(true);
    writeState("locked", { shieldsDown: false });
    expect(shields.isShieldsDown("locked", false)).toBe(false);
    writeState("down", { shieldsDown: true });
    expect(shields.isShieldsDown("down", false)).toBe(true);
    writeState("corrupt", "not json");
    expect(shields.isShieldsDown("corrupt", false)).toBe(false);
  });

  it("locks and unlocks OpenClaw config trees with sensitive files", () => {
    shields.lockAgentConfig("alpha", {
      configPath: "/sandbox/.openclaw/openclaw.json",
      configDir: "/sandbox/.openclaw",
      sensitiveFiles: ["/sandbox/.openclaw/.env"],
    });

    expect(dockerCaptureMock).toHaveBeenCalled();
    expect(dockerExecFileSyncMock.mock.calls.some(([argv]) => argv.includes("openshell-alpha-1"))).toBe(true);
    expect(dockerExecFileSyncMock.mock.calls.some(([argv]) => argv.includes("chattr") && argv.includes("+i"))).toBe(true);

    dockerExecFileSyncMock.mockImplementation((argv: string[]): string => {
      const command = argv.join(" ");
      if (command.includes("stat -c %a %U:%G")) {
        if (command.includes(".openclaw/openclaw.json") || command.includes(".openclaw/.env")) {
          return "660 sandbox:sandbox";
        }
        return "2770 sandbox:sandbox";
      }
      if (command.includes("lsattr -d")) return "---------------- /sandbox/.openclaw/openclaw.json";
      return "";
    });

    shields.unlockAgentConfig("alpha", {
      configPath: "/sandbox/.openclaw/openclaw.json",
      configDir: "/sandbox/.openclaw",
      sensitiveFiles: ["/sandbox/.openclaw/.env"],
    });

    expect(dockerExecFileSyncMock.mock.calls.some(([argv]) => argv.includes("chattr") && argv.includes("-i"))).toBe(true);
    expect(dockerExecFileSyncMock.mock.calls.some(([argv]) => argv.includes("chmod") && argv.includes("2770"))).toBe(true);
  });
});
