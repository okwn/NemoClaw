// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

type MaintenanceModule = typeof import("../../../dist/lib/actions/maintenance");

const maintenance = require("../../../dist/lib/actions/maintenance") as MaintenanceModule;
const dockerImage = require("../../../dist/lib/adapters/docker/image") as typeof import("../../../dist/lib/adapters/docker/image");
const openshellRuntime = require("../../../dist/lib/adapters/openshell/runtime") as typeof import("../../../dist/lib/adapters/openshell/runtime");
const credentials = require("../../../dist/lib/credentials/store") as typeof import("../../../dist/lib/credentials/store");
const registry = require("../../../dist/lib/state/registry") as typeof import("../../../dist/lib/state/registry");
const sandboxState = require("../../../dist/lib/state/sandbox") as typeof import("../../../dist/lib/state/sandbox");

const logs: string[] = [];
const errors: string[] = [];

beforeEach(() => {
  logs.length = 0;
  errors.length = 0;
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    logs.push(String(message ?? ""));
  });
  vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
    errors.push(String(message ?? ""));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("maintenance actions", () => {
  it("reports when no registered sandboxes are available to back up", () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({ defaultSandbox: null, sandboxes: [] });

    maintenance.backupAll();

    expect(logs.join("\n")).toContain("No sandboxes registered");
  });

  it("backs up only live sandboxes and exits when a backup fails", () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }],
    });
    vi.spyOn(openshellRuntime, "captureOpenshell").mockReturnValue({
      output: "NAME\nalpha Ready\ngamma Ready\n",
      status: 0,
    });
    vi.spyOn(sandboxState, "backupSandboxState").mockImplementation(((name: string) =>
      name === "alpha"
        ? {
            backedUpDirs: ["memory"],
            backedUpFiles: ["config"],
            failedDirs: [],
            failedFiles: [],
            manifest: { backupPath: "/tmp/backup-alpha" },
            success: true,
          }
        : {
            backedUpDirs: [],
            backedUpFiles: [],
            failedDirs: ["memory"],
            failedFiles: [],
            manifest: null,
            success: false,
          }) as never);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    maintenance.backupAll();

    expect(sandboxState.backupSandboxState).toHaveBeenCalledWith("alpha");
    expect(sandboxState.backupSandboxState).not.toHaveBeenCalledWith("beta");
    expect(sandboxState.backupSandboxState).toHaveBeenCalledWith("gamma");
    expect(logs.join("\n")).toContain("1 backed up, 1 failed, 1 skipped");
    expect(errors.join("\n")).toContain("gamma: backup failed");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports empty sandbox image inventory without registry lookup", async () => {
    vi.spyOn(dockerImage, "dockerListImagesFormat").mockReturnValue("");
    const registrySpy = vi.spyOn(registry, "listSandboxes");

    await maintenance.garbageCollectImages({ yes: true });

    expect(logs.join("\n")).toContain("No sandbox images found");
    expect(registrySpy).not.toHaveBeenCalled();
  });

  it("dry-runs orphan sandbox image cleanup", async () => {
    vi.spyOn(dockerImage, "dockerListImagesFormat").mockReturnValue(
      "openshell/sandbox-from:used\t1GB\nopenshell/sandbox-from:old\t2GB\n",
    );
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha", imageTag: "openshell/sandbox-from:used" }],
    });
    const rmi = vi.spyOn(dockerImage, "dockerRmi");

    await maintenance.garbageCollectImages({ dryRun: true });

    expect(logs.join("\n")).toContain("openshell/sandbox-from:old");
    expect(logs.join("\n")).toContain("--dry-run: would remove 1 image");
    expect(rmi).not.toHaveBeenCalled();
  });

  it("prompts and removes orphan sandbox images", async () => {
    vi.spyOn(dockerImage, "dockerListImagesFormat").mockReturnValue("openshell/sandbox-from:old\t2GB\n");
    vi.spyOn(registry, "listSandboxes").mockReturnValue({ defaultSandbox: null, sandboxes: [] });
    vi.spyOn(credentials, "prompt").mockResolvedValue("yes");
    vi.spyOn(dockerImage, "dockerRmi").mockReturnValue({
      error: undefined,
      signal: null,
      status: 0,
      stderr: "",
      stdout: "",
    } as never);

    await maintenance.garbageCollectImages({});

    expect(credentials.prompt).toHaveBeenCalledWith(expect.stringContaining("Remove 1 orphaned image"));
    expect(dockerImage.dockerRmi).toHaveBeenCalledWith(
      "openshell/sandbox-from:old",
      expect.objectContaining({ ignoreError: true, suppressOutput: true }),
    );
    expect(logs.join("\n")).toContain("Removed 1 orphaned image");
  });
});
