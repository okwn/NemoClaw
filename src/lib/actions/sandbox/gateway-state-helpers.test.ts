// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  getReconciledSandboxGatewayState,
  mergeLivePolicyIntoSandboxOutput,
  printGatewayLifecycleHint,
  printWrongGatewayActiveGuidance,
} from "../../../../dist/lib/actions/sandbox/gateway-state";

describe("sandbox gateway-state helpers", () => {
  it("leaves sandbox output unchanged when no policy section exists", () => {
    expect(mergeLivePolicyIntoSandboxOutput("Sandbox:\n  Name: alpha\n", "version: 1\n")).toBe(
      "Sandbox:\n  Name: alpha\n",
    );
  });

  it("merges live policy YAML and rewrites version from Active metadata", () => {
    const output = "Sandbox:\n  Name: alpha\nPolicy:\n  stale: true\nStatus: Ready\n";
    const livePolicy = "Active: 7\n---\nversion: 1\nnetwork_policies:\n  - name: web\n";
    expect(mergeLivePolicyIntoSandboxOutput(output, livePolicy)).toBe(
      "Sandbox:\n  Name: alpha\nPolicy:\n\n  version: 7\n  network_policies:\n    - name: web\n",
    );
  });

  it("rejects empty, error-like, and non-yaml live policy output", () => {
    const output = "Sandbox:\nPolicy:\n  old: true\n";
    expect(mergeLivePolicyIntoSandboxOutput(output, "---\n\n")).toBe(output);
    expect(mergeLivePolicyIntoSandboxOutput(output, "---\nError: unavailable\n")).toBe(output);
    expect(mergeLivePolicyIntoSandboxOutput(output, "---\njust text\n")).toBe(output);
  });

  it("prints wrong active gateway guidance", () => {
    const lines: string[] = [];
    printWrongGatewayActiveGuidance("alpha", "other", (line) => lines.push(line));
    expect(lines.join("\n")).toContain("currently active OpenShell gateway is 'other'");
    expect(lines.join("\n")).toContain("openshell gateway select nemoclaw");

    const defaultLines: string[] = [];
    printWrongGatewayActiveGuidance("alpha", "nemoclaw", (line) => defaultLines.push(line));
    expect(defaultLines.join("\n")).toContain("currently active OpenShell gateway is 'another gateway'");
  });

  it("prints lifecycle hints for common gateway failure modes", () => {
    const cases = [
      {
        output: "No gateway configured",
        expected: "no longer configured",
      },
      {
        output: "Gateway: nemoclaw\nError: Connection refused",
        expected: "API is refusing connections",
      },
      {
        output: "handshake verification failed",
        expected: "gateway identity drift",
      },
      {
        output: "transport error",
        expected: "current gateway/runtime is not reachable",
      },
      {
        output: "Missing gateway auth token",
        expected: "auth or device identity state is not usable",
      },
    ];

    for (const { output, expected } of cases) {
      const lines: string[] = [];
      printGatewayLifecycleHint(output, "alpha", (line) => lines.push(line));
      expect(lines.join("\n")).toContain(expected);
    }
  });

  it("returns present and passthrough non-reconciled states without gateway recovery", async () => {
    await expect(
      getReconciledSandboxGatewayState("alpha", {
        getState: async () => ({ state: "present", output: "Ready" }),
      }),
    ).resolves.toEqual({ state: "present", output: "Ready" });

    await expect(
      getReconciledSandboxGatewayState("alpha", {
        getState: async () => ({ state: "unknown_error", output: "boom" }),
      }),
    ).resolves.toEqual({ state: "unknown_error", output: "boom" });
  });
});
