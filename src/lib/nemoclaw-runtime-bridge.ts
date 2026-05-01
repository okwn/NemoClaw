// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/* v8 ignore start -- transitional bridge until command actions are extracted from src/nemoclaw.ts. */

export interface NemoClawRuntimeBridge {
  sandboxChannelsAdd: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxChannelsList: (sandboxName: string) => void;
  sandboxChannelsRemove: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxChannelsStart: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxChannelsStop: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxConnect: (sandboxName: string) => Promise<void>;
  sandboxDestroy: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxLogs: (sandboxName: string, follow: boolean) => void;
  sandboxPolicyAdd: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxPolicyList: (sandboxName: string) => void;
  sandboxPolicyRemove: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxRebuild: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxSkillInstall: (sandboxName: string, args?: string[]) => Promise<void>;
  sandboxStatus: (sandboxName: string) => Promise<void>;
  upgradeSandboxes: (args?: string[]) => Promise<void>;
}

let runtimeFactory = (): NemoClawRuntimeBridge =>
  (require("../nemoclaw") as { runtimeBridge: NemoClawRuntimeBridge }).runtimeBridge;

export function setNemoClawRuntimeBridgeFactoryForTest(
  factory: () => NemoClawRuntimeBridge,
): void {
  runtimeFactory = factory;
}

export function getNemoClawRuntimeBridge(): NemoClawRuntimeBridge {
  return runtimeFactory();
}
