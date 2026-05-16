// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { GpuDetection } from "../inference/nim";
import { getResumeSandboxGpuOverrides, resolveSandboxGpuConfig } from "./sandbox-gpu-mode";

function gpu(overrides: Partial<GpuDetection> = {}): GpuDetection {
  return {
    type: "nvidia",
    count: 1,
    totalMemoryMB: 24_000,
    perGpuMB: 24_000,
    nimCapable: true,
    ...overrides,
  };
}

describe("sandbox GPU mode helpers", () => {
  it("resolves sandbox GPU auto/force/disable modes", () => {
    const detectedGpu = gpu();
    expect(resolveSandboxGpuConfig(detectedGpu, { env: {} }).sandboxGpuEnabled).toBe(true);
    expect(
      resolveSandboxGpuConfig(detectedGpu, {
        env: { NEMOCLAW_SANDBOX_GPU: "0" },
      }).sandboxGpuEnabled,
    ).toBe(false);
    const forced = resolveSandboxGpuConfig(null, {
      flag: "enable",
      env: {},
    });
    expect(forced.mode).toBe("1");
    expect(forced.errors.join("\n")).toContain("no NVIDIA GPU");
  });

  it("defaults to CPU sandbox on Jetson when NEMOCLAW_SANDBOX_GPU is unset", () => {
    const jetson = gpu({ platform: "jetson" });
    expect(resolveSandboxGpuConfig(jetson, { env: {} }).sandboxGpuEnabled).toBe(false);
    expect(
      resolveSandboxGpuConfig(jetson, { env: { NEMOCLAW_SANDBOX_GPU: "1" } }).sandboxGpuEnabled,
    ).toBe(true);
    expect(resolveSandboxGpuConfig(jetson, { flag: "enable", env: {} }).mode).toBe("1");
  });

  it("resumes sandbox GPU auto mode without turning CPU fallback into explicit opt-out", () => {
    const resumedAuto = getResumeSandboxGpuOverrides(
      { sandboxGpuMode: "auto", sandboxGpuDevice: null },
      false,
    );
    expect(resumedAuto).toEqual({ flag: null, device: null });
    expect(
      resolveSandboxGpuConfig(gpu(), { ...resumedAuto, env: {} }).sandboxGpuEnabled,
    ).toBe(true);

    const resumedDisabled = getResumeSandboxGpuOverrides(
      { sandboxGpuMode: "0", sandboxGpuDevice: null },
      false,
    );
    expect(
      resolveSandboxGpuConfig(gpu(), { ...resumedDisabled, env: {} }).sandboxGpuEnabled,
    ).toBe(false);

    const legacyGpuSession = getResumeSandboxGpuOverrides(null, true);
    expect(legacyGpuSession.flag).toBe("enable");
  });
});
