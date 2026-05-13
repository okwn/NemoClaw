// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOrphanedSandboxRollbackMessage,
  createDashboardForwardHelpers,
  findDashboardForwardOwner,
  findForwardEntry,
  getOccupiedPorts,
  getRunningForwardPorts,
  isLiveForwardStatus,
} from "./dashboard-forward";

function deps(forwardList = "") {
  return {
    getDashboardForwardPort: vi.fn(() => "18789"),
    getDashboardForwardTarget: vi.fn((url?: string) => (url?.includes("18790") ? "18790" : "18789")),
    runCapture: vi.fn(() => ""),
    runCaptureOpenshell: vi.fn(() => forwardList),
    runOpenshell: vi.fn(() => ({ status: 0 })),
    cliName: vi.fn(() => "nemoclaw"),
    warn: vi.fn(),
    error: vi.fn(),
    exitProcess: vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as (code: number) => never,
  };
}

afterEach(() => {
  delete process.env.CHAT_UI_URL;
});

describe("dashboard forward helpers", () => {
  const forwardList = [
    "SANDBOX BIND PORT PID STATUS",
    "alpha 127.0.0.1 18789 123 running",
    "beta 127.0.0.1 18790 124 stopped",
    "gamma 127.0.0.1 18791 125 active",
  ].join("\n");

  it("parses forward ownership and statuses", () => {
    expect(findDashboardForwardOwner(forwardList, "18789")).toBe("alpha");
    expect(findForwardEntry(forwardList, "18791")).toEqual({ sandboxName: "gamma", status: "active" });
    expect(isLiveForwardStatus("running")).toBe(true);
    expect(isLiveForwardStatus("stopped")).toBe(false);
    expect(getRunningForwardPorts(forwardList)).toEqual(["18789", "18791"]);
    expect([...getOccupiedPorts(forwardList).entries()]).toEqual([
      ["18789", "alpha"],
      ["18791", "gamma"],
    ]);
  });

  it("builds rollback messages", () => {
    expect(buildOrphanedSandboxRollbackMessage("alpha", new Error("no ports"), false)).toEqual([
      "",
      "  Could not allocate a dashboard port for 'alpha'.",
      "  no ports",
      "  Could not remove the orphaned sandbox. Manual cleanup:",
      '    openshell sandbox delete "alpha"',
    ]);
  });

  it("stops all running dashboard forwards", () => {
    const d = deps(forwardList);
    const helpers = createDashboardForwardHelpers(d);

    helpers.stopAllDashboardForwards();

    expect(d.runOpenshell).toHaveBeenCalledWith(["forward", "stop", "18789"], { ignoreError: true });
    expect(d.runOpenshell).toHaveBeenCalledWith(["forward", "stop", "18791"], { ignoreError: true });
  });

  it("keeps the preferred port when it is already owned by the sandbox", () => {
    const d = deps(forwardList);
    const helpers = createDashboardForwardHelpers(d);

    expect(helpers.findAvailableDashboardPort("alpha", 18789, forwardList)).toBe(18789);
  });

  it("allocates an alternate port and starts the forward", () => {
    const d = deps(forwardList);
    const helpers = createDashboardForwardHelpers(d);

    expect(helpers.ensureDashboardForward("delta", "http://127.0.0.1:18789")).toBe(18790);

    expect(d.warn).toHaveBeenCalledWith("  ! Port 18789 is taken. Using port 18790 instead.");
    expect(d.runOpenshell).toHaveBeenCalledWith(
      ["forward", "start", "--background", "18790", "delta"],
      { ignoreError: true, stdio: ["ignore", "ignore", "ignore"] },
    );
  });

  it("rolls back the sandbox when port allocation fails during create", () => {
    const occupied = Array.from({ length: 12 }, (_, index) => {
      const port = 18789 + index;
      return `sb${index} 127.0.0.1 ${port} ${index} running`;
    }).join("\n");
    const d = deps(occupied);
    const helpers = createDashboardForwardHelpers(d);

    expect(() =>
      helpers.ensureDashboardForward("delta", "http://127.0.0.1:18789", {
        rollbackSandboxOnFailure: true,
      }),
    ).toThrow(/exit 1/);

    expect(d.runOpenshell).toHaveBeenCalledWith(["sandbox", "delete", "delta"], { ignoreError: true });
  });
});
