// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  findReadableNvidiaCdiSpecFiles,
  getDockerCdiSpecDirs,
} from "./docker-cdi";
import { buildDirectSandboxGpuProofCommands } from "./initial-policy";
import type { SandboxGpuConfig, SandboxGpuFlag } from "./sandbox-gpu-mode";

export interface SandboxGpuFlagOptions {
  sandboxGpu?: SandboxGpuFlag;
  gpu?: boolean;
  noGpu?: boolean;
}

export function resolveSandboxGpuFlagFromOptions(
  opts: SandboxGpuFlagOptions,
): SandboxGpuFlag {
  const requestedGpuPassthrough = opts.gpu === true;
  const optedOutGpuPassthrough = opts.noGpu === true;
  const sandboxGpuFlag = opts.sandboxGpu ?? null;
  if (requestedGpuPassthrough && optedOutGpuPassthrough) {
    console.error("  --gpu and --no-gpu cannot both be set.");
    process.exit(1);
  }
  if (
    (requestedGpuPassthrough && sandboxGpuFlag === "disable") ||
    (optedOutGpuPassthrough && sandboxGpuFlag === "enable")
  ) {
    console.error("  --gpu/--no-gpu conflict with the sandbox GPU flags.");
    process.exit(1);
  }
  if (sandboxGpuFlag) return sandboxGpuFlag;
  if (requestedGpuPassthrough) return "enable";
  if (optedOutGpuPassthrough) return "disable";
  return null;
}

export function sandboxGpuRemediationLines(): string[] {
  return [
    "Install/configure NVIDIA Container Toolkit CDI, then restart Docker:",
    "  sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml",
    "  sudo systemctl restart docker",
    "Or force CPU sandbox behavior with NEMOCLAW_SANDBOX_GPU=0.",
  ];
}

export interface DirectSandboxGpuVerifierDeps {
  runOpenshell(args: string[], opts?: Record<string, unknown>): { status?: number | null; stdout?: unknown; stderr?: unknown };
  compactText(value: string): string;
  redact(value: unknown): string;
}

export function createDirectSandboxGpuVerifier(deps: DirectSandboxGpuVerifierDeps) {
  return function verifyDirectSandboxGpu(sandboxName: string): void {
    console.log("  Verifying direct sandbox GPU access...");
    for (const proof of buildDirectSandboxGpuProofCommands(sandboxName)) {
      const result = deps.runOpenshell(proof.args, {
        ignoreError: true,
        suppressOutput: true,
        timeout: 30_000,
      });
      if (result.status === 0) {
        console.log(`  ✓ GPU proof passed: ${proof.label}`);
        continue;
      }
      if (proof.optional === true) return;
      const diagnostic = deps.compactText(deps.redact(`${result.stderr || ""} ${result.stdout || ""}`));
      console.error(`  ✗ GPU proof failed: ${proof.label}`);
      if (diagnostic) console.error(`    ${diagnostic.slice(0, 300)}`);
      for (const line of sandboxGpuRemediationLines()) {
        console.error(`    ${line}`);
      }
      const statusText = String(result.status || 1);
      const diagnosticSuffix = diagnostic ? `: ${diagnostic.slice(0, 300)}` : "";
      throw new Error(`GPU proof failed: ${proof.label} (status ${statusText})${diagnosticSuffix}`);
    }
  };
}

export function validateSandboxGpuPreflight(config: SandboxGpuConfig): void {
  if (config.errors.length > 0) {
    console.error("");
    for (const error of config.errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }
  if (!config.sandboxGpuEnabled) return;
  if (process.platform !== "linux") return;

  const cdiSpecDirs = getDockerCdiSpecDirs();
  const cdiSpecFiles = findReadableNvidiaCdiSpecFiles(cdiSpecDirs);
  if (cdiSpecFiles.length === 0) {
    console.error("");
    console.error("  ✗ Docker CDI GPU support was not detected.");
    for (const line of sandboxGpuRemediationLines()) console.error(`    ${line}`);
    process.exit(1);
  }
  console.log(`  ✓ Docker CDI GPU support detected (${cdiSpecFiles.join(", ")})`);
}
