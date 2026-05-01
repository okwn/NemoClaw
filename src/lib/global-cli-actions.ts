// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/* v8 ignore start -- transitional action facade until implementations leave src/nemoclaw.ts. */

import { runDeployAction as executeDeployAction } from "./deploy-action";
import { getNemoClawRuntimeBridge } from "./nemoclaw-runtime-bridge";
import { help, version } from "./root-help-action";

export async function runOnboardAction(args: string[] = []): Promise<void> {
  await getNemoClawRuntimeBridge().onboard(args);
}

export async function runSetupAction(args: string[] = []): Promise<void> {
  await getNemoClawRuntimeBridge().setup(args);
}

export async function runSetupSparkAction(args: string[] = []): Promise<void> {
  await getNemoClawRuntimeBridge().setupSpark(args);
}

export async function runDeployAction(instanceName?: string): Promise<void> {
  await executeDeployAction(instanceName);
}

export function runBackupAllAction(): void {
  getNemoClawRuntimeBridge().backupAll();
}

export async function runUpgradeSandboxesAction(args: string[] = []): Promise<void> {
  await getNemoClawRuntimeBridge().upgradeSandboxes(args);
}

export async function runGarbageCollectImagesAction(args: string[] = []): Promise<void> {
  await getNemoClawRuntimeBridge().garbageCollectImages(args);
}

export function showRootHelp(): void {
  help();
}

export function showVersion(): void {
  version();
}

export async function recoverNamedGatewayRuntime(): Promise<{ recovered: boolean }> {
  return getNemoClawRuntimeBridge().recoverNamedGatewayRuntime();
}

export function runOpenshellProviderCommand(
  args: string[],
  opts?: { ignoreError?: boolean; stdio?: import("node:child_process").StdioOptions },
) {
  return getNemoClawRuntimeBridge().runOpenshell(args, opts);
}
