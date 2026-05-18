// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { PublicCommandDisplayEntry } from "./command-display";
import {
  getRegisteredOclifCommandMetadata,
  getRegisteredOclifCommandsMetadata,
  type OclifCommandMetadata,
} from "./oclif-metadata";
import { globalRouteTokenVariants, sandboxRouteTokens } from "./public-route-metadata";

export type NativeArgvTranslation = {
  kind: "nativeArgv";
  commandId: string;
  args: string[];
  argv: string[];
};

export type PublicHelpTranslation = {
  kind: "publicHelp";
  publicUsage: string | string[];
  commandId: string;
  exitCode?: number;
  message?: string;
};

export type PublicUsageErrorTranslation = {
  kind: "publicUsageError";
  lines: string[];
};

export type UnknownPublicActionTranslation = {
  kind: "unknownPublicAction";
  action: string;
};

export type PublicTranslationResult =
  | NativeArgvTranslation
  | PublicHelpTranslation
  | PublicUsageErrorTranslation
  | UnknownPublicActionTranslation;

type LegacyRoute = {
  commandId: string;
  legacyTokens: string[];
  publicUsage: string;
};

type GlobalRoute = {
  commandId: string;
  tokens: string[];
};

type RegisteredCommand = {
  commandId: string;
  metadata: OclifCommandMetadata;
};

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function registeredCommands(): RegisteredCommand[] {
  return Object.entries(getRegisteredOclifCommandsMetadata()).map(([commandId, metadata]) => ({
    commandId,
    metadata,
  }));
}

function registeredCommandIds(): Set<string> {
  return new Set(Object.keys(getRegisteredOclifCommandsMetadata()));
}

function hasChildCommand(commandId: string, commandIds: ReadonlySet<string>): boolean {
  return [...commandIds].some((id) => id.startsWith(`${commandId}:`));
}

function publicDisplayEntries(metadata: OclifCommandMetadata): readonly PublicCommandDisplayEntry[] {
  return metadata.publicDisplay ?? metadata.display ?? [];
}

function publicUsageFromDisplayEntry(entry: PublicCommandDisplayEntry): string {
  const usage = entry.usage.replace(/^nemoclaw\s+/, "");
  return entry.flags ? `${usage} ${entry.flags}` : usage;
}

function fallbackPublicUsage(commandId: string, routeTokens: readonly string[]): string {
  if (commandId.startsWith("sandbox:")) return `<name> ${routeTokens.join(" ")}`.trim();
  return routeTokens.join(" ");
}

function publicUsageForCommand(
  commandId: string,
  metadata: OclifCommandMetadata,
  routeTokens: readonly string[],
): string {
  const [entry] = publicDisplayEntries(metadata);
  if (entry) return publicUsageFromDisplayEntry(entry);
  return fallbackPublicUsage(commandId, routeTokens);
}

function publicUsageEntriesForCommand(
  commandId: string,
): { usage: string; order: number }[] {
  const metadata = getRegisteredOclifCommandMetadata(commandId);
  if (!metadata) return [];
  return publicDisplayEntries(metadata).map((entry) => ({
    usage: publicUsageFromDisplayEntry(entry),
    order: entry.order,
  }));
}

function publicUsagesForCommand(commandId: string): string[] {
  return publicUsageEntriesForCommand(commandId).map((entry) => entry.usage);
}

function legacyRoutes(): LegacyRoute[] {
  const commandIds = registeredCommandIds();
  return registeredCommands()
    .filter(({ commandId }) => commandId.startsWith("sandbox:"))
    .filter(({ commandId }) => !hasChildCommand(commandId, commandIds))
    .map(({ commandId, metadata }) => {
      const legacyTokens = sandboxRouteTokens(commandId) ?? [];
      return {
        commandId,
        legacyTokens,
        publicUsage: publicUsageForCommand(commandId, metadata, legacyTokens),
      };
    })
    .filter((route) => route.legacyTokens.length > 0)
    .sort((a, b) => b.legacyTokens.length - a.legacyTokens.length);
}

function parentPublicUsage(action: string): string[] {
  const lines = legacyRoutes()
    .filter((route) => route.legacyTokens[0] === action)
    .flatMap((route) => publicUsageEntriesForCommand(route.commandId))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.usage);
  return [...new Set(lines)];
}

function globalRoutes(): GlobalRoute[] {
  const commandIds = registeredCommandIds();
  return registeredCommands()
    .filter(({ commandId }) => !commandId.startsWith("sandbox:"))
    .filter(({ commandId }) => !commandId.startsWith("internal:"))
    .filter(({ commandId }) => !hasChildCommand(commandId, commandIds))
    .flatMap(({ commandId }) =>
      globalRouteTokenVariants(commandId).map((tokens) => ({
        commandId,
        tokens,
      })),
    )
    .filter((route) => route.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length);
}

function globalParentPublicUsage(topic: string): string[] {
  const commandIds = new Set(
    globalRoutes()
      .filter((route) => route.tokens[0] === topic)
      .map((route) => route.commandId),
  );
  return [
    ...new Set(
      [...commandIds].flatMap((commandId) => publicUsagesForCommand(commandId)),
    ),
  ];
}

function startsWithTokens(tokens: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((token, index) => tokens[index] === token);
}

function routeToNativeArgv(route: LegacyRoute, sandboxName: string, args: string[]): PublicTranslationResult {
  if (hasHelpFlag(args)) {
    return { kind: "publicHelp", commandId: route.commandId, publicUsage: route.publicUsage };
  }
  return nativeArgv(route.commandId, [sandboxName, ...args]);
}

function nativeArgv(commandId: string, args: string[]): NativeArgvTranslation {
  return { kind: "nativeArgv", commandId, args, argv: [...commandId.split(":"), ...args] };
}

function globalParentHelp(topic: string, message?: string): PublicHelpTranslation {
  return {
    kind: "publicHelp",
    commandId: topic,
    publicUsage: globalParentPublicUsage(topic),
    exitCode: message ? 1 : undefined,
    message,
  };
}

export function translatePublicGlobalArgv(cmd: string, args: string[]): PublicTranslationResult {
  const inputTokens = [cmd, ...args];
  for (const route of globalRoutes()) {
    if (!startsWithTokens(inputTokens, route.tokens)) continue;
    return nativeArgv(route.commandId, inputTokens.slice(route.tokens.length));
  }

  if (cmd === "tunnel" || cmd === "inference" || cmd === "credentials") {
    const subcommand = args[0];
    if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
      return globalParentHelp(cmd);
    }
    return globalParentHelp(cmd, `Unknown ${cmd} subcommand: ${subcommand}`);
  }

  return { kind: "publicUsageError", lines: [] };
}

function parentSubcommands(action: string): Set<string> {
  return new Set(
    legacyRoutes()
      .filter((route) => route.legacyTokens[0] === action)
      .map((route) => route.legacyTokens[1])
      .filter((token): token is string => Boolean(token)),
  );
}

function hasRegisteredOclifParentCommand(action: string): boolean {
  return getRegisteredOclifCommandMetadata(`sandbox:${action}`) !== null;
}

function parentHelp(action: string, message?: string): PublicHelpTranslation {
  return {
    kind: "publicHelp",
    commandId: `sandbox:${action}`,
    publicUsage: parentPublicUsage(action),
    exitCode: message ? 1 : undefined,
    message,
  };
}

export function translatePublicSandboxArgv(
  sandboxName: string,
  action: string,
  actionArgs: string[],
): PublicTranslationResult {
  if (action === "connect") {
    return nativeArgv("sandbox:connect", [sandboxName, ...actionArgs]);
  }

  if (action === "channels" && actionArgs.length === 0) {
    return nativeArgv("sandbox:channels:list", [sandboxName]);
  }

  if (action === "skill" && actionArgs[0] === "install" && hasHelpFlag(actionArgs.slice(1))) {
    return nativeArgv("sandbox:skill", [sandboxName, ...actionArgs]);
  }

  const inputTokens = [action, ...actionArgs];
  for (const route of legacyRoutes()) {
    if (!startsWithTokens(inputTokens, route.legacyTokens)) continue;
    const remainingArgs = inputTokens.slice(route.legacyTokens.length);
    return routeToNativeArgv(route, sandboxName, remainingArgs);
  }

  if (action === "channels") {
    const subcommand = actionArgs[0] ?? "";
    if (!parentSubcommands("channels").has(subcommand)) {
      return parentHelp("channels", `Unknown channels subcommand: ${subcommand}`);
    }
  }

  if (action === "config" || action === "shields") {
    if (actionArgs.length === 0 || hasHelpFlag(actionArgs)) return parentHelp(action);
    const subcommand = actionArgs[0] ?? "";
    return parentHelp(action, `Unknown ${action} subcommand: ${subcommand}`);
  }

  if (action === "share" && hasHelpFlag(actionArgs)) {
    return {
      kind: "publicHelp",
      commandId: "sandbox:share",
      publicUsage: "<name> share <mount|unmount|status>",
    };
  }

  if (hasRegisteredOclifParentCommand(action)) {
    return nativeArgv(`sandbox:${action}`, [sandboxName, ...(hasHelpFlag(actionArgs) ? [] : actionArgs)]);
  }

  return { kind: "unknownPublicAction", action };
}
