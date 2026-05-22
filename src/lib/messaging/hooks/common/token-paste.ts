// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  MessagingHookHandler,
  MessagingHookOutputMap,
  MessagingHookRegistration,
} from "../types";

export const COMMON_TOKEN_PASTE_HOOK_HANDLER_ID = "common.tokenPaste";

export const fakeTokenPasteHook: MessagingHookHandler = (context) => {
  const outputs: Record<string, MessagingHookOutputMap[string]> = {};

  for (const output of context.outputDeclarations ?? []) {
    if (output.kind !== "secret") continue;
    outputs[output.id] = {
      kind: "secret",
      value: `fake-${context.channelId}-${output.id}`,
    };
  }

  return { outputs };
};

export const FAKE_COMMON_HOOK_REGISTRATIONS: readonly MessagingHookRegistration[] = [
  {
    id: COMMON_TOKEN_PASTE_HOOK_HANDLER_ID,
    handler: fakeTokenPasteHook,
  },
] as const;
