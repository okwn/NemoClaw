// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { installerProviderHelpValues, installerProviderUsageLines, normalizeInstallerProvider } from "./provider";

describe("installer provider helpers", () => {
  it("normalizes installer provider aliases and case variants", () => {
    expect(normalizeInstallerProvider("cloud")).toBe("build");
    expect(normalizeInstallerProvider("nim")).toBe("nim-local");
    expect(normalizeInstallerProvider("anthropiccompatible")).toBe("anthropicCompatible");
    expect(normalizeInstallerProvider(" AnthropicCompatible ")).toBe("anthropicCompatible");
    expect(normalizeInstallerProvider("vllm")).toBe("vllm");
    expect(normalizeInstallerProvider("")).toBeNull();
    expect(normalizeInstallerProvider("unsupported")).toBeNull();
  });

  it("keeps help text values aligned with install.sh usage", () => {
    expect(installerProviderHelpValues()).toBe(
      "build, openai, anthropic, anthropicCompatible, gemini, ollama, custom, nim-local, vllm",
    );
    expect(installerProviderUsageLines()).toEqual([
      "build | openai | anthropic | anthropicCompatible",
      "gemini | ollama | custom | nim-local | vllm",
      "aliases: cloud -> build, nim -> nim-local",
    ]);
  });
});
