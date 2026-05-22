// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { slackManifest, telegramManifest } from "../../channels";
import { runMessagingHook } from "../hook-runner";
import { MessagingHookRegistry } from "../registry";
import {
  COMMON_TOKEN_PASTE_HOOK_HANDLER_ID,
  FAKE_COMMON_HOOK_REGISTRATIONS,
} from "./token-paste";

describe("common token-paste hook implementation", () => {
  it("uses the shared handler id declared by token-paste channel manifests", () => {
    expect(FAKE_COMMON_HOOK_REGISTRATIONS.map((registration) => registration.id)).toEqual([
      COMMON_TOKEN_PASTE_HOOK_HANDLER_ID,
    ]);
    expect(telegramManifest.hooks[0]?.handler).toBe(COMMON_TOKEN_PASTE_HOOK_HANDLER_ID);
    expect(slackManifest.hooks[0]?.handler).toBe(COMMON_TOKEN_PASTE_HOOK_HANDLER_ID);
  });

  it("shows the single-token enrollment output shape", async () => {
    const registry = new MessagingHookRegistry(FAKE_COMMON_HOOK_REGISTRATIONS);
    const hook = telegramManifest.hooks[0];

    if (!hook) throw new Error("missing Telegram token-paste hook");

    await expect(
      runMessagingHook(hook, registry, {
        channelId: "telegram",
      }),
    ).resolves.toMatchObject({
      handlerId: COMMON_TOKEN_PASTE_HOOK_HANDLER_ID,
      phase: "enroll",
      outputs: {
        botToken: {
          kind: "secret",
          value: "fake-telegram-botToken",
        },
      },
    });
  });

  it("shows the multi-token enrollment output shape", async () => {
    const registry = new MessagingHookRegistry(FAKE_COMMON_HOOK_REGISTRATIONS);
    const hook = slackManifest.hooks[0];

    if (!hook) throw new Error("missing Slack token-paste hook");

    await expect(
      runMessagingHook(hook, registry, {
        channelId: "slack",
      }),
    ).resolves.toMatchObject({
      handlerId: COMMON_TOKEN_PASTE_HOOK_HANDLER_ID,
      phase: "enroll",
      outputs: {
        botToken: {
          kind: "secret",
          value: "fake-slack-botToken",
        },
        appToken: {
          kind: "secret",
          value: "fake-slack-appToken",
        },
      },
    });
  });
});
