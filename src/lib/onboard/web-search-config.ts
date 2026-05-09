// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { CurlProbeResult } from "../adapters/http/probe";
import type { ValidationClassification } from "../validation";
import type { ValidationFailureLike } from "./types";
import type { WebSearchAgent } from "./web-search-support";
import { BRAVE_API_KEY_ENV, type WebSearchConfig } from "../inference/web-search";

type PromptOptions = { secret?: boolean };
type PromptFn = (message: string, options?: PromptOptions) => Promise<string>;
type RunCurlProbeFn = (args: string[]) => CurlProbeResult;
type ClassifyValidationFailureFn = (failure: ValidationFailureLike) => ValidationClassification;
type GetTransportRecoveryMessageFn = (failure: ValidationFailureLike) => string;
type AgentSupportsWebSearchFn = (
  agent: WebSearchAgent,
  dockerfilePathOverride?: string | null,
  rootDir?: string,
) => boolean;

export type WebSearchConfigDeps = {
  runCurlProbe: RunCurlProbeFn;
  classifyValidationFailure: ClassifyValidationFailureFn;
  getTransportRecoveryMessage: GetTransportRecoveryMessageFn;
  getCredential: (envName: string) => string | null;
  saveCredential: (envName: string, value: string) => void;
  normalizeCredentialValue: (value: string | undefined | null) => string;
  prompt: PromptFn;
  isNonInteractive: () => boolean;
  note: (message: string) => void;
  cliName: () => string;
  exitOnboardFromPrompt: () => never;
  agentSupportsWebSearch: AgentSupportsWebSearchFn;
  rootDir: string;
  env?: NodeJS.ProcessEnv;
};

export const BRAVE_SEARCH_HELP_URL = "https://brave.com/search/api/";

export function createWebSearchConfigHelpers(deps: WebSearchConfigDeps) {
  const env = deps.env ?? process.env;

  function validateBraveSearchApiKey(apiKey: string): CurlProbeResult {
    return deps.runCurlProbe([
      "-sS",
      "--compressed",
      "-H",
      "Accept: application/json",
      "-H",
      "Accept-Encoding: gzip",
      "-H",
      `X-Subscription-Token: ${apiKey}`,
      "--get",
      "--data-urlencode",
      "q=ping",
      "--data-urlencode",
      "count=1",
      "https://api.search.brave.com/res/v1/web/search",
    ]);
  }

  async function promptBraveSearchRecovery(
    validation: ValidationFailureLike,
  ): Promise<"retry" | "skip"> {
    const recovery = deps.classifyValidationFailure(validation);

    if (recovery.kind === "credential") {
      console.log("  Brave Search rejected that API key.");
    } else if (recovery.kind === "transport") {
      console.log(deps.getTransportRecoveryMessage(validation));
    } else {
      console.log("  Brave Search validation did not succeed.");
    }

    const answer = (await deps.prompt("  Type 'retry', 'skip', or 'exit' [retry]: "))
      .trim()
      .toLowerCase();
    if (answer === "skip") return "skip";
    if (answer === "exit" || answer === "quit") {
      deps.exitOnboardFromPrompt();
    }
    return "retry";
  }

  async function promptBraveSearchApiKey(): Promise<string> {
    console.log("");
    console.log(`  Get your Brave Search API key from: ${BRAVE_SEARCH_HELP_URL}`);
    console.log("");

    while (true) {
      const key = deps.normalizeCredentialValue(
        await deps.prompt("  Brave Search API key: ", { secret: true }),
      );
      if (!key) {
        console.error("  Brave Search API key is required.");
        continue;
      }
      return key;
    }
  }

  async function ensureValidatedBraveSearchCredential(
    nonInteractive = deps.isNonInteractive(),
  ): Promise<string | null> {
    const savedApiKey = deps.getCredential(BRAVE_API_KEY_ENV);
    let apiKey: string | null = savedApiKey || deps.normalizeCredentialValue(env[BRAVE_API_KEY_ENV]);
    let usingSavedKey = Boolean(savedApiKey);

    while (true) {
      if (!apiKey) {
        if (nonInteractive) {
          throw new Error(
            "Brave Search requires BRAVE_API_KEY or a saved Brave Search credential in non-interactive mode.",
          );
        }
        apiKey = await promptBraveSearchApiKey();
        usingSavedKey = false;
      }

      const validation = validateBraveSearchApiKey(apiKey);
      if (validation.ok) {
        deps.saveCredential(BRAVE_API_KEY_ENV, apiKey);
        env[BRAVE_API_KEY_ENV] = apiKey;
        return apiKey;
      }

      const prefix = usingSavedKey
        ? "  Saved Brave Search API key validation failed."
        : "  Brave Search API key validation failed.";
      console.error(prefix);
      if (validation.message) {
        console.error(`  ${validation.message}`);
      }

      if (nonInteractive) {
        throw new Error(
          validation.message || "Brave Search API key validation failed in non-interactive mode.",
        );
      }

      const action = await promptBraveSearchRecovery(validation);
      if (action === "skip") {
        console.log("  Skipping Brave Web Search setup.");
        console.log("");
        return null;
      }

      apiKey = null;
      usingSavedKey = false;
    }
  }

  async function configureWebSearch(
    existingConfig: WebSearchConfig | null = null,
    agent: WebSearchAgent = null,
    dockerfilePathOverride: string | null = null,
  ): Promise<WebSearchConfig | null> {
    if (!deps.agentSupportsWebSearch(agent, dockerfilePathOverride, deps.rootDir)) {
      deps.note(`  Web search is not yet supported by ${agent?.displayName ?? "this agent"}. Skipping.`);
      return null;
    }

    if (existingConfig) {
      return { fetchEnabled: true };
    }

    if (deps.isNonInteractive()) {
      const braveApiKey = deps.normalizeCredentialValue(env[BRAVE_API_KEY_ENV]);
      if (!braveApiKey) {
        return null;
      }
      deps.note("  [non-interactive] Brave Web Search requested.");
      const validation = validateBraveSearchApiKey(braveApiKey);
      if (!validation.ok) {
        console.warn(
          `  Brave Search API key validation failed. Web search will be disabled — re-enable later via \`${deps.cliName()} config web-search\`.`,
        );
        if (validation.message) {
          console.warn(`  ${validation.message}`);
        }
        return null;
      }
      deps.saveCredential(BRAVE_API_KEY_ENV, braveApiKey);
      env[BRAVE_API_KEY_ENV] = braveApiKey;
      return { fetchEnabled: true };
    }
    const enableAnswer = await deps.prompt("  Enable Brave Web Search? [y/N]: ");
    if (!["y", "yes"].includes(enableAnswer.trim().toLowerCase())) {
      return null;
    }

    const braveApiKey = await ensureValidatedBraveSearchCredential();
    if (!braveApiKey) {
      return null;
    }

    console.log("  ✓ Enabled Brave Web Search");
    console.log("");
    return { fetchEnabled: true };
  }

  return {
    validateBraveSearchApiKey,
    promptBraveSearchRecovery,
    promptBraveSearchApiKey,
    ensureValidatedBraveSearchCredential,
    configureWebSearch,
  };
}
