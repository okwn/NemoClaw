// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

type UpgradeModule = typeof import("../../../dist/lib/actions/upgrade-sandboxes");

const action = require("../../../dist/lib/actions/upgrade-sandboxes") as UpgradeModule;
const openshellRuntime = require("../../../dist/lib/adapters/openshell/runtime") as typeof import("../../../dist/lib/adapters/openshell/runtime");
const credentials = require("../../../dist/lib/credentials/store") as typeof import("../../../dist/lib/credentials/store");
const registry = require("../../../dist/lib/state/registry") as typeof import("../../../dist/lib/state/registry");
const sandboxVersion = require("../../../dist/lib/sandbox/version") as typeof import("../../../dist/lib/sandbox/version");
const rebuild = require("../../../dist/lib/actions/sandbox/rebuild") as typeof import("../../../dist/lib/actions/sandbox/rebuild");

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

function liveSandboxList(names: string[]): { output: string; status: number } {
  return { output: `NAME\n${names.map((name) => `${name} Ready`).join("\n")}\n`, status: 0 };
}

describe("upgradeSandboxes action", () => {
  it("returns when no sandboxes are registered", async () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({ defaultSandbox: null, sandboxes: [] });

    await action.upgradeSandboxes({ check: true });

    expect(logs.join("\n")).toContain("No sandboxes found");
  });

  it("exits when live sandbox lookup fails", async () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha" }],
    });
    vi.spyOn(openshellRuntime, "captureOpenshell").mockReturnValue({
      output: "boom",
      status: 7,
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await action.upgradeSandboxes({ check: true });

    expect(errors.join("\n")).toContain("Failed to query running sandboxes");
    expect(exit).toHaveBeenCalledWith(7);
  });

  it("reports current sandboxes as up to date", async () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha" }],
    });
    vi.spyOn(openshellRuntime, "captureOpenshell").mockReturnValue(liveSandboxList(["alpha"]));
    vi.spyOn(sandboxVersion, "checkAgentVersion").mockReturnValue({
      detectionMethod: "registry",
      expectedVersion: "2.0.0",
      isStale: false,
      sandboxVersion: "2.0.0",
    });

    await action.upgradeSandboxes({ check: true });

    expect(logs.join("\n")).toContain("All sandboxes are up to date");
  });

  it("prints stale and unknown sandboxes in check mode", async () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha" }, { name: "beta" }],
    });
    vi.spyOn(openshellRuntime, "captureOpenshell").mockReturnValue(liveSandboxList(["alpha"]));
    vi.spyOn(sandboxVersion, "checkAgentVersion").mockImplementation((name: string) =>
      name === "alpha"
        ? { detectionMethod: "registry", expectedVersion: "2.0.0", isStale: true, sandboxVersion: "1.0.0" }
        : { detectionMethod: "unavailable", expectedVersion: "2.0.0", isStale: false, sandboxVersion: null },
    );

    await action.upgradeSandboxes({ check: true });

    const output = logs.join("\n");
    expect(output).toContain("Stale sandboxes");
    expect(output).toContain("alpha");
    expect(output).toContain("Unknown version");
    expect(output).toContain("beta");
    expect(output).toContain("Run `nemoclaw upgrade-sandboxes`");
  });

  it("skips stopped stale sandboxes when no running stale sandbox remains", async () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha" }],
    });
    vi.spyOn(openshellRuntime, "captureOpenshell").mockReturnValue(liveSandboxList([]));
    vi.spyOn(sandboxVersion, "checkAgentVersion").mockReturnValue({
      detectionMethod: "registry",
      expectedVersion: "2.0.0",
      isStale: true,
      sandboxVersion: "1.0.0",
    });
    const rebuildSpy = vi.spyOn(rebuild, "rebuildSandbox");

    await action.upgradeSandboxes({ yes: true });

    expect(logs.join("\n")).toContain("No running stale sandboxes");
    expect(rebuildSpy).not.toHaveBeenCalled();
  });

  it("prompts before rebuilding and tracks failures", async () => {
    vi.spyOn(registry, "listSandboxes").mockReturnValue({
      defaultSandbox: "alpha",
      sandboxes: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }],
    });
    vi.spyOn(openshellRuntime, "captureOpenshell").mockReturnValue(liveSandboxList(["alpha", "beta", "gamma"]));
    vi.spyOn(sandboxVersion, "checkAgentVersion").mockReturnValue({
      detectionMethod: "registry",
      expectedVersion: "2.0.0",
      isStale: true,
      sandboxVersion: "1.0.0",
    });
    vi.spyOn(credentials, "prompt")
      .mockResolvedValueOnce("no")
      .mockResolvedValueOnce("yes")
      .mockResolvedValueOnce("yes");
    vi.spyOn(rebuild, "rebuildSandbox").mockImplementation(async (name: string) => {
      if (name === "gamma") throw new Error("boom");
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await action.upgradeSandboxes({});

    expect(credentials.prompt).toHaveBeenCalledWith(expect.stringContaining("Rebuild 'alpha'"));
    expect(rebuild.rebuildSandbox).not.toHaveBeenCalledWith("alpha", expect.anything(), expect.anything());
    expect(rebuild.rebuildSandbox).toHaveBeenCalledWith("beta", ["--yes"], { throwOnError: true });
    expect(rebuild.rebuildSandbox).toHaveBeenCalledWith("gamma", ["--yes"], { throwOnError: true });
    expect(errors.join("\n")).toContain("Failed to rebuild 'gamma': boom");
    expect(logs.join("\n")).toContain("1 sandbox(es) rebuilt");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
