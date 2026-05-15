// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const captureOpenshell = vi.fn();
const dockerInspect = vi.fn();
const listBackups = vi.fn();
const backupSandboxState = vi.fn();
const findBackup = vi.fn();
const parseRestoreArgs = vi.fn();
const getLatestBackup = vi.fn();
const restoreSandboxState = vi.fn();
const getAppliedPresets = vi.fn();
const applyPreset = vi.fn();
const removePreset = vi.fn();
const getSandbox = vi.fn();

let runSandboxSnapshot: typeof import("../../../../dist/lib/actions/sandbox/snapshot").runSandboxSnapshot;

function loadSnapshotAction(): void {
  const modules = {
    "../../../../dist/lib/adapters/openshell/runtime": { captureOpenshell, getOpenshellBinary: () => "openshell" },
    "../../../../dist/lib/adapters/docker": { dockerInspect, dockerCapture: vi.fn() },
    "../../../../dist/lib/state/sandbox": {
      listBackups,
      backupSandboxState,
      findBackup,
      parseRestoreArgs,
      getLatestBackup,
      restoreSandboxState,
    },
    "../../../../dist/lib/policy": { getAppliedPresets, applyPreset, removePreset },
    "../../../../dist/lib/state/registry": { getSandbox, registerSandbox: vi.fn() },
  };
  for (const [id, exports] of Object.entries(modules)) {
    const resolved = require.resolve(id);
    delete require.cache[resolved];
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports,
      children: [],
      paths: [],
    } as unknown as NodeJS.Module;
  }
  const actionPath = require.resolve("../../../../dist/lib/actions/sandbox/snapshot");
  delete require.cache[actionPath];
  ({ runSandboxSnapshot } = require(actionPath));
}

describe("sandbox snapshot action", () => {
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.resetAllMocks();
    dockerInspect.mockReturnValue({ status: 0, stdout: "true\n" });
    captureOpenshell.mockReturnValue({ status: 0, output: "alpha Ready\n" });
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => logs.push(String(message ?? "")));
    vi.spyOn(console, "error").mockImplementation((message?: unknown) => errors.push(String(message ?? "")));
    vi.spyOn(console, "warn").mockImplementation((message?: unknown) => errors.push(String(message ?? "")));
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);
    loadSnapshotAction();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints usage for help/default subcommands", async () => {
    await runSandboxSnapshot("alpha", []);
    expect(logs.join("\n")).toContain("nemoclaw alpha snapshot create");
  });

  it("lists no snapshots", async () => {
    listBackups.mockReturnValue([]);
    await runSandboxSnapshot("alpha", ["list"]);
    expect(logs).toEqual(["  No snapshots found for 'alpha'."]);
  });

  it("renders snapshot list rows", async () => {
    listBackups.mockReturnValue([
      { snapshotVersion: 2, name: "daily", timestamp: "2026-05-14T00:00:00Z", backupPath: "/tmp/snap" },
    ]);
    await runSandboxSnapshot("alpha", ["list"]);
    expect(logs.join("\n")).toContain("Snapshots for 'alpha'");
    expect(logs.join("\n")).toContain("v2");
    expect(logs.join("\n")).toContain("daily");
  });

  it("rejects invalid create flags", async () => {
    await expect(runSandboxSnapshot("alpha", ["create", "--bad"])).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toContain("Unknown flag: --bad");
  });

  it("creates a named snapshot", async () => {
    backupSandboxState.mockReturnValue({
      success: true,
      manifest: { timestamp: "ts-1", backupPath: "/tmp/backup", name: "before" },
      backedUpDirs: ["memory"],
      backedUpFiles: ["user.md"],
      failedDirs: [],
      failedFiles: [],
    });
    findBackup.mockReturnValue({
      match: { snapshotVersion: 3, timestamp: "ts-1", backupPath: "/tmp/backup", name: "before" },
    });

    await runSandboxSnapshot("alpha", ["create", "--name", "before"]);

    expect(backupSandboxState).toHaveBeenCalledWith("alpha", { name: "before" });
    expect(logs.join("\n")).toContain("Snapshot v3 name=before created");
  });

  it("restores the latest snapshot and reconciles policy presets", async () => {
    const latest = {
      snapshotVersion: 1,
      timestamp: "ts-1",
      backupPath: "/tmp/backup",
      policyPresets: ["slack", "github"],
    };
    parseRestoreArgs.mockReturnValue({ ok: true, targetSandbox: "alpha", selector: null });
    getLatestBackup.mockReturnValue(latest);
    restoreSandboxState.mockReturnValue({
      success: true,
      restoredDirs: ["memory"],
      restoredFiles: ["user.md"],
      failedDirs: [],
      failedFiles: [],
    });
    getAppliedPresets.mockReturnValue(["slack", "old"]);
    applyPreset.mockReturnValue(true);
    removePreset.mockReturnValue(true);

    await runSandboxSnapshot("alpha", ["restore"]);

    expect(restoreSandboxState).toHaveBeenCalledWith("alpha", "/tmp/backup");
    expect(removePreset).toHaveBeenCalledWith("alpha", "old");
    expect(applyPreset).toHaveBeenCalledWith("alpha", "github");
    expect(logs.join("\n")).toContain("Reconciling policy presets");
  });

  it("reports restore selector misses", async () => {
    parseRestoreArgs.mockReturnValue({ ok: true, targetSandbox: "alpha", selector: "missing" });
    findBackup.mockReturnValue({ match: null });

    await expect(runSandboxSnapshot("alpha", ["restore", "missing"])).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toContain("No snapshot matching 'missing'");
  });
});
