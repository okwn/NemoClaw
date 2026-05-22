// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  buildDiscordConfig,
  buildMessagingEnvLines,
} from "../../../../agents/hermes/config/messaging-config.ts";
import { getChannelTokenKeys, KNOWN_CHANNELS } from "../../sandbox/channels";
import type { ChannelInputSpec, ChannelManifest, ChannelRenderSpec } from "../manifest";
import {
  BUILT_IN_CHANNEL_MANIFESTS,
  createBuiltInChannelManifestRegistry,
  discordManifest,
  slackManifest,
  telegramManifest,
  whatsappManifest,
} from "./index";

function findInput(manifest: ChannelManifest, inputId: string): ChannelInputSpec {
  const input = manifest.inputs.find((entry) => entry.id === inputId);
  if (!input) throw new Error(`missing input ${manifest.id}.${inputId}`);
  return input;
}

function findRender(manifest: ChannelManifest, renderId: string): ChannelRenderSpec {
  const render = manifest.render.find((entry) => entry.id === renderId);
  if (!render) throw new Error(`missing render ${manifest.id}.${renderId}`);
  return render;
}

function renderJson(manifest: ChannelManifest): string {
  return JSON.stringify(manifest.render);
}

describe("built-in channel manifests", () => {
  it("registers the phase-1 built-in manifests without consuming them in workflows", () => {
    const registry = createBuiltInChannelManifestRegistry();

    expect(BUILT_IN_CHANNEL_MANIFESTS.map((manifest) => manifest.id)).toEqual([
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(registry.list().map((manifest) => manifest.id)).toEqual([
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(registry.listAvailable({ agent: "openclaw" }).map((manifest) => manifest.id)).toEqual([
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(registry.listAvailable({ agent: "hermes" }).map((manifest) => manifest.id)).toEqual([
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
  });

  it("matches current sandbox channel metadata for prompts, auth, and policy presets", () => {
    const manifests = {
      telegram: telegramManifest,
      discord: discordManifest,
      slack: slackManifest,
      whatsapp: whatsappManifest,
    };

    for (const [channelId, manifest] of Object.entries(manifests)) {
      const legacy = KNOWN_CHANNELS[channelId];
      expect(manifest.description).toBe(legacy.description);
      expect(manifest.policyPresets).toEqual([channelId]);
      expect(manifest.supportedAgents).toEqual(["openclaw", "hermes"]);
      expect(manifest.auth.mode).toBe(legacy.loginMethod ?? "token-paste");
    }

    expect(findInput(telegramManifest, "botToken").prompt).toEqual({
      label: KNOWN_CHANNELS.telegram.label,
      help: KNOWN_CHANNELS.telegram.help,
    });
    expect(findInput(discordManifest, "botToken").prompt).toEqual({
      label: KNOWN_CHANNELS.discord.label,
      help: KNOWN_CHANNELS.discord.help,
    });
    expect(findInput(slackManifest, "botToken").prompt).toMatchObject({
      label: KNOWN_CHANNELS.slack.label,
      help: KNOWN_CHANNELS.slack.help,
      placeholder: "xoxb-...",
    });
    expect(findInput(slackManifest, "appToken").prompt).toMatchObject({
      label: KNOWN_CHANNELS.slack.appTokenLabel,
      help: KNOWN_CHANNELS.slack.appTokenHelp,
      placeholder: "xapp-...",
    });
  });

  it("declares Telegram env keys, policy, and OpenClaw/Hermes render intent", () => {
    const botToken = findInput(telegramManifest, "botToken");
    const allowedIds = findInput(telegramManifest, "allowedIds");
    const requireMention = findInput(telegramManifest, "requireMention");
    const hermesLines = buildMessagingEnvLines(
      new Set(["telegram"]),
      { telegram: ["123456789"] },
      {},
      {},
    );

    expect(getChannelTokenKeys(KNOWN_CHANNELS.telegram)).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(botToken.envKey).toBe("TELEGRAM_BOT_TOKEN");
    expect(allowedIds.envKey).toBe("TELEGRAM_ALLOWED_IDS");
    expect(requireMention.envKey).toBe("TELEGRAM_REQUIRE_MENTION");
    expect(KNOWN_CHANNELS.telegram.allowIdsMode).toBe("dm");
    expect(telegramManifest.credentials).toEqual([
      {
        id: "telegramBotToken",
        sourceInput: "botToken",
        providerName: "{sandboxName}-telegram-bridge",
        providerEnvKey: "TELEGRAM_BOT_TOKEN",
        placeholder: "openshell:resolve:env:TELEGRAM_BOT_TOKEN",
      },
    ]);
    expect(hermesLines).toContain(
      "TELEGRAM_BOT_TOKEN=openshell:resolve:env:TELEGRAM_BOT_TOKEN",
    );
    expect(hermesLines).toContain("TELEGRAM_ALLOWED_USERS=123456789");
    expect(renderJson(telegramManifest)).toContain("channels.telegram.accounts.default");
    expect(renderJson(telegramManifest)).toContain("groupPolicy");
    expect(renderJson(telegramManifest)).toContain("channels.telegram.groups");
    expect(renderJson(telegramManifest)).toContain("telegramConfig.requireMention");
  });

  it("declares Discord guild and allowlist render intent for both agents", () => {
    const botToken = findInput(discordManifest, "botToken");
    const serverId = findInput(discordManifest, "serverId");
    const requireMention = findInput(discordManifest, "requireMention");
    const userId = findInput(discordManifest, "userId");
    const hermesLines = buildMessagingEnvLines(
      new Set(["discord"]),
      {},
      {
        "1491590992753590594": {
          requireMention: false,
          users: ["1005536447329222676"],
        },
      },
      {},
    );

    expect(getChannelTokenKeys(KNOWN_CHANNELS.discord)).toEqual(["DISCORD_BOT_TOKEN"]);
    expect(botToken.envKey).toBe("DISCORD_BOT_TOKEN");
    expect(serverId.envKey).toBe("DISCORD_SERVER_ID");
    expect(requireMention.envKey).toBe("DISCORD_REQUIRE_MENTION");
    expect(userId.envKey).toBe("DISCORD_USER_ID");
    expect(KNOWN_CHANNELS.discord.allowIdsMode).toBe("guild");
    expect(discordManifest.credentials).toEqual([
      {
        id: "discordBotToken",
        sourceInput: "botToken",
        providerName: "{sandboxName}-discord-bridge",
        providerEnvKey: "DISCORD_BOT_TOKEN",
        placeholder: "openshell:resolve:env:DISCORD_BOT_TOKEN",
      },
    ]);
    expect(buildDiscordConfig({ "1491590992753590594": { requireMention: false } })).toEqual({
      require_mention: false,
      free_response_channels: "",
      allowed_channels: "",
      auto_thread: true,
      reactions: true,
      channel_prompts: {},
    });
    expect(hermesLines).toContain(
      "DISCORD_BOT_TOKEN=openshell:resolve:env:DISCORD_BOT_TOKEN",
    );
    expect(hermesLines).toContain("NEMOCLAW_DISCORD_GUILD_IDS=1491590992753590594");
    expect(hermesLines).toContain("DISCORD_ALLOWED_USERS=1005536447329222676");
    expect(renderJson(discordManifest)).toContain("channels.discord.accounts.default");
    expect(renderJson(discordManifest)).toContain("channels.discord");
    expect(renderJson(discordManifest)).toContain("discord.guilds");
    expect(renderJson(discordManifest)).toContain("require_mention");
  });

  it("declares Slack Bolt-compatible placeholders and allowlist render intent", () => {
    const botToken = findInput(slackManifest, "botToken");
    const appToken = findInput(slackManifest, "appToken");
    const allowedUsers = findInput(slackManifest, "allowedUsers");
    const hermesLines = buildMessagingEnvLines(
      new Set(["slack"]),
      { slack: ["U0123456789"] },
      {},
      {},
    );

    expect(getChannelTokenKeys(KNOWN_CHANNELS.slack)).toEqual([
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
    ]);
    expect(botToken.envKey).toBe("SLACK_BOT_TOKEN");
    expect(appToken.envKey).toBe("SLACK_APP_TOKEN");
    expect(allowedUsers.envKey).toBe("SLACK_ALLOWED_USERS");
    expect(KNOWN_CHANNELS.slack.allowIdsMode).toBe("dm");
    expect(slackManifest.credentials).toEqual([
      {
        id: "slackBotToken",
        sourceInput: "botToken",
        providerName: "{sandboxName}-slack-bridge",
        providerEnvKey: "SLACK_BOT_TOKEN",
        placeholder: "xoxb-OPENSHELL-RESOLVE-ENV-SLACK_BOT_TOKEN",
      },
      {
        id: "slackAppToken",
        sourceInput: "appToken",
        providerName: "{sandboxName}-slack-app",
        providerEnvKey: "SLACK_APP_TOKEN",
        placeholder: "xapp-OPENSHELL-RESOLVE-ENV-SLACK_APP_TOKEN",
      },
    ]);
    expect(hermesLines).toContain(
      "SLACK_BOT_TOKEN=xoxb-OPENSHELL-RESOLVE-ENV-SLACK_BOT_TOKEN",
    );
    expect(hermesLines).toContain(
      "SLACK_APP_TOKEN=xapp-OPENSHELL-RESOLVE-ENV-SLACK_APP_TOKEN",
    );
    expect(hermesLines).toContain("SLACK_ALLOWED_USERS=U0123456789");
    expect(renderJson(slackManifest)).toContain("channels.slack.accounts.default");
    expect(renderJson(slackManifest)).toContain("allowedIds.slack.channels");
  });

  it("declares WhatsApp as in-sandbox QR with no host-side token bindings", () => {
    const openclawRender = findRender(whatsappManifest, "whatsapp-openclaw-account");
    const hermesRender = findRender(whatsappManifest, "whatsapp-hermes-env");
    const hermesLines = buildMessagingEnvLines(new Set(["whatsapp"]), {}, {}, {});

    expect(getChannelTokenKeys(KNOWN_CHANNELS.whatsapp)).toEqual([]);
    expect(whatsappManifest.auth.mode).toBe("in-sandbox-qr");
    expect(whatsappManifest.inputs).toEqual([]);
    expect(whatsappManifest.credentials).toEqual([]);
    expect(whatsappManifest.policyPresets).toEqual(["whatsapp"]);
    expect(openclawRender).toMatchObject({
      kind: "json-fragment",
      agent: "openclaw",
      target: "openclaw.json",
    });
    expect(JSON.stringify(openclawRender)).toContain("channels.whatsapp.accounts.default");
    expect(hermesRender).toMatchObject({
      kind: "env-lines",
      agent: "hermes",
      target: "~/.hermes/.env",
    });
    expect(hermesLines).toContain("WHATSAPP_ENABLED=true");
    expect(hermesLines).toContain("WHATSAPP_MODE=bot");
    expect(renderJson(whatsappManifest)).not.toContain("WHATSAPP_BOT_TOKEN");
    expect(renderJson(whatsappManifest)).not.toContain("openshell:resolve:env:WHATSAPP");
  });
});
