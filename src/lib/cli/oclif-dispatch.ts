// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { globalCommands, sandboxCommands } from "./command-registry";

export type OclifDispatch = {
  kind: "oclif";
  commandId: string;
  args: string[];
};

export type HelpDispatch = {
  kind: "help";
  publicUsage: string | string[];
  commandId: string;
  exitCode?: number;
  message?: string;
};

export type UsageErrorDispatch = {
  kind: "usageError";
  lines: string[];
};

export type UnknownSubcommandDispatch = {
  kind: "unknownSubcommand";
  command: "credentials";
  subcommand: string;
};

export type UnknownActionDispatch = {
  kind: "unknownAction";
  action: string;
};

export type DispatchResult =
  | OclifDispatch
  | HelpDispatch
  | UsageErrorDispatch
  | UnknownSubcommandDispatch
  | UnknownActionDispatch;

type LegacyRoute = {
  commandId: string;
  legacyTokens: string[];
  publicUsage: string;
};

type GlobalRoute = {
  commandId: string;
  tokens: string[];
};

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function literalTokensFromUsage(usage: string, prefixPattern: RegExp): string[] {
  const rest = usage.replace(prefixPattern, "");
  const tokens: string[] = [];
  for (const token of rest.split(/\s+/)) {
    if (!token || token.startsWith("[") || token.startsWith("<") || token.startsWith("(")) break;
    if (token.startsWith("-")) {
      if (tokens.length === 0) tokens.push(token);
      break;
    }
    tokens.push(token);
  }
  return tokens;
}

function legacyTokensFromUsage(usage: string): string[] {
  return literalTokensFromUsage(usage, /^nemoclaw\s+<name>\s*/);
}

function globalTokensFromUsage(usage: string): string[] {
  return literalTokensFromUsage(usage, /^nemoclaw\s+/);
}

function publicUsageFromCommand(command: ReturnType<typeof sandboxCommands>[number]): string {
  const usage = command.usage.replace(/^nemoclaw\s+/, "");
  return command.flags ? `${usage} ${command.flags}` : usage;
}

function legacyRoutes(): LegacyRoute[] {
  return sandboxCommands()
    .map((command) => ({
      commandId: command.commandId,
      legacyTokens: legacyTokensFromUsage(command.usage),
      publicUsage: publicUsageFromCommand(command),
    }))
    .filter((route) => route.legacyTokens.length > 0)
    .sort((a, b) => b.legacyTokens.length - a.legacyTokens.length);
}

function parentPublicUsage(action: string): string[] {
  const lines = legacyRoutes()
    .filter((route) => route.legacyTokens[0] === action)
    .map((route) => route.publicUsage);
  return [...new Set(lines)];
}

function globalRoutes(): GlobalRoute[] {
  return globalCommands()
    .map((command) => ({
      commandId: command.commandId,
      tokens: globalTokensFromUsage(command.usage),
    }))
    .filter((route) => route.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length);
}

function startsWithTokens(tokens: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((token, index) => tokens[index] === token);
}

function routeToOclif(route: LegacyRoute, sandboxName: string, args: string[]): DispatchResult {
  if (hasHelpFlag(args)) {
    return { kind: "help", commandId: route.commandId, publicUsage: route.publicUsage };
  }
  return {
    kind: "oclif",
    commandId: route.commandId,
    args: [sandboxName, ...args],
  };
}

function oclif(commandId: string, args: string[]): OclifDispatch {
  return { kind: "oclif", commandId, args };
}

export function resolveGlobalOclifDispatch(cmd: string, args: string[]): DispatchResult {
  const inputTokens = [cmd, ...args];
  for (const route of globalRoutes()) {
    if (!startsWithTokens(inputTokens, route.tokens)) continue;
    return oclif(route.commandId, inputTokens.slice(route.tokens.length));
  }

  if (cmd === "tunnel") {
    return { kind: "usageError", lines: ["tunnel <start|stop>"] };
  }

  if (cmd === "inference") {
    return {
      kind: "usageError",
      lines: [
        "inference get [--json]",
        "inference set --provider <provider> --model <model> [--sandbox <name>] [--no-verify]",
      ],
    };
  }

  if (cmd === "credentials") {
    const sub = args[0];
    if (!sub || sub === "help" || sub === "--help" || sub === "-h") return oclif("credentials", []);
    return { kind: "unknownSubcommand", command: "credentials", subcommand: sub };
  }

  if (cmd === "version") {
    return oclif("root:version", []);
  }

  return { kind: "usageError", lines: [] };
}

const CHANNEL_SUBCOMMANDS = new Set(["add", "list", "remove", "start", "stop"]);

const PARENT_ACTIONS = new Set(["share", "skill", "snapshot"]);

function parentHelp(action: string, message?: string): HelpDispatch {
  return {
    kind: "help",
    commandId: `sandbox:${action}`,
    publicUsage: parentPublicUsage(action),
    exitCode: message ? 1 : undefined,
    message,
  };
}

export function resolveLegacySandboxDispatch(
  sandboxName: string,
  action: string,
  actionArgs: string[],
): DispatchResult {
  if (action === "connect") {
    return { kind: "oclif", commandId: "sandbox:connect", args: [sandboxName, ...actionArgs] };
  }

  if (action === "channels" && actionArgs.length === 0) {
    return { kind: "oclif", commandId: "sandbox:channels:list", args: [sandboxName] };
  }

  if (action === "skill" && actionArgs[0] === "install" && hasHelpFlag(actionArgs.slice(1))) {
    return { kind: "oclif", commandId: "sandbox:skill", args: [sandboxName, ...actionArgs] };
  }

  const inputTokens = [action, ...actionArgs];
  for (const route of legacyRoutes()) {
    if (!startsWithTokens(inputTokens, route.legacyTokens)) continue;
    const remainingArgs = inputTokens.slice(route.legacyTokens.length);
    return routeToOclif(route, sandboxName, remainingArgs);
  }

  if (action === "channels") {
    const subcommand = actionArgs[0] ?? "";
    if (!CHANNEL_SUBCOMMANDS.has(subcommand)) {
      return parentHelp("channels", `Unknown channels subcommand: ${subcommand}`);
    }
  }

  if (action === "config" || action === "shields") {
    return parentHelp(action);
  }

  if (action === "share" && hasHelpFlag(actionArgs)) {
    return { kind: "help", commandId: "sandbox:share", publicUsage: "<name> share <mount|unmount|status>" };
  }

  if (PARENT_ACTIONS.has(action)) {
    return {
      kind: "oclif",
      commandId: `sandbox:${action}`,
      args: [sandboxName, ...(hasHelpFlag(actionArgs) ? [] : actionArgs)],
    };
  }

  return { kind: "unknownAction", action };
}

export const resolveSandboxOclifDispatch = resolveLegacySandboxDispatch;
