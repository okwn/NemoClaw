// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { createWebSearchConfigHelpers } from "./web-search-config";

function makeDeps(overrides: Partial<Parameters<typeof createWebSearchConfigHelpers>[0]> = {}) {
  const env: NodeJS.ProcessEnv = {};
  return {
    env,
    runCurlProbe: vi.fn(() => ({ ok: true, httpStatus: 200, curlStatus: 0, body: "{}", stderr: "", message: "ok" })),
    classifyValidationFailure: vi.fn(() => ({ kind: "credential" as const, retry: "credential" as const })),
    getTransportRecoveryMessage: vi.fn(() => "transport failed"),
    getCredential: vi.fn(() => null),
    saveCredential: vi.fn(),
    normalizeCredentialValue: vi.fn((value: string | undefined | null) => String(value || "").trim()),
    prompt: vi.fn(async () => ""),
    isNonInteractive: vi.fn(() => false),
    note: vi.fn(),
    cliName: vi.fn(() => "nemoclaw"),
    exitOnboardFromPrompt: vi.fn(() => {
      throw new Error("exit");
    }) as () => never,
    agentSupportsWebSearch: vi.fn(() => true),
    rootDir: "/repo",
    ...overrides,
  };
}

describe("web search config helpers", () => {
  it("validates Brave Search with the expected curl request", () => {
    const deps = makeDeps();
    const helpers = createWebSearchConfigHelpers(deps);

    expect(helpers.validateBraveSearchApiKey("brave-key").ok).toBe(true);

    expect(deps.runCurlProbe).toHaveBeenCalledWith(
      expect.arrayContaining(["-H", "X-Subscription-Token: brave-key", "https://api.search.brave.com/res/v1/web/search"]),
    );
  });

  it("skips configuration when the agent image does not support web search", async () => {
    const deps = makeDeps({ agentSupportsWebSearch: vi.fn(() => false) });
    const helpers = createWebSearchConfigHelpers(deps);

    await expect(helpers.configureWebSearch(null, { name: "hermes", displayName: "Hermes" })).resolves.toBeNull();

    expect(deps.note).toHaveBeenCalledWith("  Web search is not yet supported by Hermes. Skipping.");
  });

  it("returns an enabled config when existing config is present", async () => {
    const deps = makeDeps();
    const helpers = createWebSearchConfigHelpers(deps);

    await expect(helpers.configureWebSearch({ fetchEnabled: true })).resolves.toEqual({ fetchEnabled: true });
    expect(deps.prompt).not.toHaveBeenCalled();
  });

  it("uses BRAVE_API_KEY non-interactively when validation succeeds", async () => {
    const deps = makeDeps({ isNonInteractive: vi.fn(() => true) });
    deps.env.BRAVE_API_KEY = " brave-key ";
    const helpers = createWebSearchConfigHelpers(deps);

    await expect(helpers.configureWebSearch()).resolves.toEqual({ fetchEnabled: true });

    expect(deps.saveCredential).toHaveBeenCalledWith("BRAVE_API_KEY", "brave-key");
    expect(deps.env.BRAVE_API_KEY).toBe("brave-key");
  });

  it("prompts for and saves a Brave API key interactively", async () => {
    const deps = makeDeps({ prompt: vi.fn().mockResolvedValueOnce("y").mockResolvedValueOnce(" brave-key ") });
    const helpers = createWebSearchConfigHelpers(deps);

    await expect(helpers.configureWebSearch()).resolves.toEqual({ fetchEnabled: true });

    expect(deps.saveCredential).toHaveBeenCalledWith("BRAVE_API_KEY", "brave-key");
  });

  it("returns null when interactive recovery chooses skip", async () => {
    const deps = makeDeps({
      runCurlProbe: vi.fn(() => ({ ok: false, httpStatus: 401, curlStatus: 0, body: "", stderr: "", message: "bad key" })),
      prompt: vi.fn().mockResolvedValueOnce("brave-key").mockResolvedValueOnce("skip"),
    });
    const helpers = createWebSearchConfigHelpers(deps);

    await expect(helpers.ensureValidatedBraveSearchCredential(false)).resolves.toBeNull();
  });
});
