// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import {
  cleanupSandboxServices,
  cleanupShieldsDestroyArtifacts,
  removeSandboxImage,
  removeSandboxRegistryEntry,
  removeShieldsState,
} from "../../../../dist/lib/actions/sandbox/destroy";

describe("sandbox destroy helper actions", () => {
  it("stops host services without double-unloading Ollama models", () => {
    const stopAll = vi.fn();
    const unloadOllamaModels = vi.fn();
    const runOpenshell = vi.fn((_args: string[], _opts?: Record<string, unknown>) => ({ status: 0 }));
    const removed: string[] = [];

    cleanupSandboxServices(
      "alpha",
      { stopHostServices: true },
      {
        stopAll,
        unloadOllamaModels,
        runOpenshell,
        rmSync: (target) => removed.push(String(target)),
      },
    );

    expect(stopAll).toHaveBeenCalledWith({ sandboxName: "alpha" });
    expect(unloadOllamaModels).not.toHaveBeenCalled();
    expect(removed).toEqual(["/tmp/nemoclaw-services-alpha"]);
    expect(runOpenshell.mock.calls.map(([args]) => args)).toEqual([
      ["provider", "delete", "alpha-telegram-bridge"],
      ["provider", "delete", "alpha-discord-bridge"],
      ["provider", "delete", "alpha-slack-bridge"],
      ["provider", "delete", "alpha-slack-app"],
    ]);
  });

  it("unloads Ollama models when destroying an Ollama-backed sandbox only", () => {
    const unloadOllamaModels = vi.fn();
    const runOpenshell = vi.fn((_args: string[], _opts?: Record<string, unknown>) => ({ status: 0 }));

    cleanupSandboxServices(
      "alpha",
      {},
      {
        getSandbox: () => ({ name: "alpha", provider: "ollama-local" }),
        unloadOllamaModels,
        runOpenshell,
        rmSync: () => {
          throw new Error("ignore missing pid dir");
        },
      },
    );
    expect(unloadOllamaModels).toHaveBeenCalledTimes(1);

    cleanupSandboxServices("beta", {}, {
      getSandbox: () => ({ name: "beta", provider: "nvidia-prod" }),
      unloadOllamaModels,
      runOpenshell,
      rmSync: () => undefined,
    });
    expect(unloadOllamaModels).toHaveBeenCalledTimes(1);
  });

  it("removes shields state files and warns on real removal failures", () => {
    const removed: string[] = [];
    const warnings: string[] = [];
    removeShieldsState("alpha", "/tmp/nemoclaw-state", {
      rmSync: (target) => {
        removed.push(String(target));
        if (String(target).includes("shields-timer")) {
          const err = new Error("permission denied") as NodeJS.ErrnoException;
          err.code = "EPERM";
          throw err;
        }
      },
      warn: (message) => warnings.push(message),
    });

    expect(removed).toEqual([
      "/tmp/nemoclaw-state/shields-alpha.json",
      "/tmp/nemoclaw-state/shields-timer-alpha.json",
    ]);
    expect(warnings.join("\n")).toContain("permission denied");
  });

  it("does not warn when shields state files are already absent", () => {
    const warn = vi.fn();
    removeShieldsState("alpha", "/tmp/nemoclaw-state", {
      rmSync: () => {
        const err = new Error("missing") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("removes sandbox images and reports success or cleanup guidance", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    removeSandboxImage("alpha", {
      getSandbox: () => ({ name: "alpha", imageTag: "nemoclaw/alpha:latest" }),
      dockerRmi: () => ({ status: 0 }),
    });
    expect(log.mock.calls.flat().join("\n")).toContain("Removed Docker image nemoclaw/alpha:latest");

    removeSandboxImage("beta", {
      getSandbox: () => ({ name: "beta", imageTag: "nemoclaw/beta:latest" }),
      dockerRmi: () => ({ status: 1 }),
    });
    expect(warn.mock.calls.flat().join("\n")).toContain("Failed to remove Docker image nemoclaw/beta:latest");

    const dockerRmi = vi.fn(() => ({ status: 0 }));
    removeSandboxImage("gamma", { getSandbox: () => null, dockerRmi });
    expect(dockerRmi).not.toHaveBeenCalled();

    log.mockRestore();
    warn.mockRestore();
  });

  it("removes image before removing registry entries", () => {
    const calls: string[] = [];
    const result = removeSandboxRegistryEntry("alpha", {
      removeImage: (sandboxName) => calls.push(`image:${sandboxName}`),
      removeSandbox: (sandboxName) => {
        calls.push(`registry:${sandboxName}`);
        return true;
      },
    });
    expect(result).toBe(true);
    expect(calls).toEqual(["image:alpha", "registry:alpha"]);
  });

  it("cleans shields timers and artifacts together", () => {
    const warnings: string[] = [];
    const removed: string[] = [];
    cleanupShieldsDestroyArtifacts("alpha", {
      stateDir: "/tmp/nemoclaw-state",
      killShieldsTimer: () => ({ warnings: ["timer warning"] }),
      warn: (message) => warnings.push(message),
      rmSync: (target) => removed.push(String(target)),
    });

    expect(warnings).toEqual(["timer warning"]);
    expect(removed).toEqual([
      "/tmp/nemoclaw-state/shields-alpha.json",
      "/tmp/nemoclaw-state/shields-timer-alpha.json",
    ]);
  });
});
