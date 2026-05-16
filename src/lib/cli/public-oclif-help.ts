// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { CommandHelp } from "@oclif/core";

import { CLI_NAME } from "./branding";
import { getRegisteredOclifCommandMetadata, type OclifCommandMetadata } from "./oclif-metadata";

type PublicHelpCommand = OclifCommandMetadata & {
  aliases?: string[];
  examples?: string[];
  flags: Record<string, unknown>;
  hiddenAliases?: string[];
  id: string;
};

export type PublicUsage = string | readonly string[];

class PublicUsageCommandHelp extends CommandHelp {
  public constructor(command: PublicHelpCommand, publicUsage: string) {
    super(
      command as never,
      {
        bin: CLI_NAME,
        platform: process.platform,
        shell: process.env.SHELL ?? "",
        theme: undefined,
      } as never,
      { flagSortOrder: "none" } as never,
    );
    this.publicUsage = publicUsage;
  }

  private readonly publicUsage: string;

  protected override usage(): string {
    return `$ ${CLI_NAME} ${this.publicUsage}`;
  }
}

function publicRouteTokens(publicUsage: string): string[] {
  const tokens = publicUsage.split(/\s+/).filter(Boolean);
  const route = tokens[0] === "<name>" ? tokens.slice(1) : tokens;
  const literals: string[] = [];
  for (const token of route) {
    if (token.startsWith("[") || token.startsWith("<") || token.startsWith("-")) break;
    literals.push(token);
  }
  return literals;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicExamples(
  commandId: string,
  metadata: OclifCommandMetadata,
  publicUsage: string,
): string[] | undefined {
  const examples = metadata.examples;
  if (!examples || !commandId.startsWith("sandbox:")) return examples;

  const nativeRoute = commandId.split(":").slice(1);
  const publicRoute = publicRouteTokens(publicUsage);
  if (nativeRoute.length === 0 || publicRoute.length === 0) return examples;

  const nativePattern = nativeRoute.map(escapeRegExp).join("\\s+");
  const nativeExamplePattern = new RegExp(`^(.*?\\s)sandbox\\s+${nativePattern}\\s+(\\S+)(.*)$`);
  return examples.map((example) =>
    example.replace(
      nativeExamplePattern,
      (_match, prefix: string, sandboxName: string, rest: string) =>
        `${prefix}${sandboxName} ${publicRoute.join(" ")}${rest}`,
    ),
  );
}

function toPublicHelpCommand(
  commandId: string,
  metadata: OclifCommandMetadata,
  publicUsage: string,
): PublicHelpCommand {
  return {
    ...metadata,
    aliases: [],
    args: metadata.args ?? {},
    examples: publicExamples(commandId, metadata, publicUsage),
    flags: {
      ...(metadata.baseFlags ?? {}),
      ...(metadata.flags ?? {}),
    },
    hiddenAliases: [],
    id: metadata.id ?? commandId,
    strict: metadata.strict ?? true,
  };
}

function renderFallbackUsage(publicUsage: PublicUsage, log: (message?: string) => void): void {
  const usages = Array.isArray(publicUsage) ? publicUsage : [publicUsage];
  if (usages.length === 1) {
    log(`\n  Usage: ${CLI_NAME} ${usages[0]}`);
    return;
  }

  log("\n  Usage:");
  for (const usage of usages) log(`    ${CLI_NAME} ${usage}`);
}

export function renderPublicOclifHelp(
  commandId: string,
  publicUsage: PublicUsage,
  options: { error?: boolean } = {},
): void {
  const log = options.error ? console.error : console.log;
  const metadata = getRegisteredOclifCommandMetadata(commandId);
  if (!metadata || commandId === "sandbox:share" || typeof publicUsage !== "string") {
    renderFallbackUsage(publicUsage, log);
    return;
  }

  log(
    new PublicUsageCommandHelp(toPublicHelpCommand(commandId, metadata, publicUsage), publicUsage).generate(),
  );
}
