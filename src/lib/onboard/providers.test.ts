// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

const { buildProviderArgs } = require("../../../dist/lib/onboard/providers") as {
  buildProviderArgs: (
    action: "create" | "update",
    name: string,
    type: string,
    credentialEnv: string,
    baseUrl: string | null,
  ) => string[];
};

describe("onboard provider helpers", () => {
  it("builds create arguments for generic providers", () => {
    const args = buildProviderArgs(
      "create",
      "discord-bridge",
      "generic",
      "DISCORD_BOT_TOKEN",
      null,
    );
    expect(args).toEqual([
      "provider",
      "create",
      "--name",
      "discord-bridge",
      "--type",
      "generic",
      "--credential",
      "DISCORD_BOT_TOKEN",
    ]);
  });

  it("builds update arguments", () => {
    const args = buildProviderArgs("update", "inference", "openai", "NVIDIA_API_KEY", null);
    expect(args).toEqual(["provider", "update", "inference", "--credential", "NVIDIA_API_KEY"]);
  });

  it("appends OPENAI_BASE_URL config for openai providers with a base URL", () => {
    const args = buildProviderArgs(
      "create",
      "inference",
      "openai",
      "NVIDIA_API_KEY",
      "https://api.example.com/v1",
    );
    expect(args).toContain("--config");
    expect(args).toContain("OPENAI_BASE_URL=https://api.example.com/v1");
  });

  it("appends ANTHROPIC_BASE_URL config for anthropic providers with a base URL", () => {
    const args = buildProviderArgs(
      "create",
      "inference",
      "anthropic",
      "ANTHROPIC_API_KEY",
      "https://api.anthropic.example.com",
    );
    expect(args).toContain("--config");
    expect(args).toContain("ANTHROPIC_BASE_URL=https://api.anthropic.example.com");
  });

  it("ignores base URL for generic providers", () => {
    const args = buildProviderArgs(
      "create",
      "slack-bridge",
      "generic",
      "SLACK_BOT_TOKEN",
      "https://ignored.example.com",
    );
    expect(args).not.toContain("--config");
  });
});
