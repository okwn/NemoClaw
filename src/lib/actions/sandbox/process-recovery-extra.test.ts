// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  classifyForwardHealthWithReachability,
  classifySandboxForwardHealth,
  resolveSandboxDashboardPort,
} from "../../../../dist/lib/actions/sandbox/process-recovery";

describe("sandbox process recovery helper coverage", () => {
  const entries = [
    { sandboxName: "alpha", port: "18789", status: "running" },
    { sandboxName: "beta", port: "19000", status: "dead" },
  ];

  it("resolves dashboard ports from agent, registry, or default", () => {
    expect(
      resolveSandboxDashboardPort("alpha", {
        getSessionAgent: () => ({ forwardPort: 19191 }),
        getSandbox: () => ({ name: "alpha", dashboardPort: 18790 }),
      }),
    ).toBe(19191);
    expect(
      resolveSandboxDashboardPort("alpha", {
        getSessionAgent: () => null,
        getSandbox: () => ({ name: "alpha", dashboardPort: 18790 }),
      }),
    ).toBe(18790);
    expect(
      resolveSandboxDashboardPort("alpha", {
        getSessionAgent: () => ({ forwardPort: 0 }),
        getSandbox: () => ({ name: "alpha", dashboardPort: Number.NaN }),
      }),
    ).toBe(18789);
  });

  it("classifies forward ownership and status", () => {
    expect(classifySandboxForwardHealth(entries, "alpha", "18789")).toBe(true);
    expect(classifySandboxForwardHealth(entries, "alpha", "19000")).toBe("occupied");
    expect(classifySandboxForwardHealth(entries, "beta", "19000")).toBe(false);
    expect(classifySandboxForwardHealth(entries, "alpha", "19999")).toBe(false);
  });

  it("uses local reachability to override stale forward-list status", () => {
    expect(classifyForwardHealthWithReachability(entries, "beta", "19000", () => true)).toBe(true);
    expect(classifyForwardHealthWithReachability(entries, "beta", "19000", () => false)).toBe(false);
    expect(classifyForwardHealthWithReachability(entries, "alpha", "19000", () => true)).toBe("occupied");
  });
});
