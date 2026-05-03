// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("./credentials", () => ({ prompt: vi.fn() }));
vi.mock("./docker", () => ({
  dockerListImagesFormat: vi.fn(),
  dockerRmi: vi.fn(),
}));
vi.mock("./openshell-runtime", () => ({
  captureOpenshell: vi.fn(() => ({ status: 0, output: "" })),
}));
vi.mock("./registry", () => ({ listSandboxes: vi.fn(() => ({ sandboxes: [] })) }));
vi.mock("./runner", () => ({ ROOT: process.cwd() }));
vi.mock("./sandbox-state", () => ({ backupSandboxState: vi.fn() }));
vi.mock("./sandbox-rebuild-action", () => ({ rebuildSandbox: vi.fn() }));

import { findOrphanedSandboxImages, parseSandboxImageRows } from "./maintenance-actions";
import { shouldSkipUpgradeConfirmation } from "./upgrade-sandboxes-action";

describe("maintenance action helpers", () => {
  it("parses Docker image rows and fills missing sizes", () => {
    expect(
      parseSandboxImageRows("openshell/sandbox-from:one\t1GB\nopenshell/sandbox-from:two\n\n"),
    ).toEqual([
      { tag: "openshell/sandbox-from:one", size: "1GB" },
      { tag: "openshell/sandbox-from:two", size: "unknown" },
    ]);
  });

  it("finds orphaned sandbox images by registry image tags", () => {
    expect(
      findOrphanedSandboxImages(
        [
          { tag: "openshell/sandbox-from:one", size: "1GB" },
          { tag: "openshell/sandbox-from:two", size: "2GB" },
        ],
        [{ imageTag: "openshell/sandbox-from:one" }, { imageTag: null }],
      ),
    ).toEqual([{ tag: "openshell/sandbox-from:two", size: "2GB" }]);
  });

  it("detects upgrade confirmation bypass modes", () => {
    expect(shouldSkipUpgradeConfirmation({ auto: true })).toBe(true);
    expect(shouldSkipUpgradeConfirmation({ yes: true })).toBe(true);
    expect(shouldSkipUpgradeConfirmation({ check: true })).toBe(false);
  });
});
