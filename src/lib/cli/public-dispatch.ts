// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Compatibility dispatcher for NemoClaw's public CLI surface.
//
// oclif owns command discovery, parsing, help rendering, and command execution
// under src/commands/**. This module intentionally stays in front of oclif only
// for product compatibility: the public sandbox grammar is
// `nemoclaw <sandbox-name> <action>` while the oclif-native command IDs are
// `sandbox:<action>` and parse as `nemoclaw sandbox <action> <sandbox-name>`.
// Keep new command behavior in src/lib/commands/** and src/lib/actions/**; keep
// this file limited to argv normalization, compatibility routing, suggestions,
// and registry-aware sandbox-name checks.
const { ROOT, validateName } = require("../runner");
const { CLI_NAME } = require("./branding");
const { help } = require("../actions/root-help");
const { runOclifArgv, runRegisteredOclifCommand } = require("./oclif-runner");
const {
  canonicalUsageList,
  globalCommandTokens,
  sandboxActionTokens,
} = require("./command-registry");
import { normalizeArgv, suggestCommand } from "./argv-normalizer";
import { renderPublicOclifHelp } from "./public-oclif-help";
import {
  resolveGlobalOclifDispatch,
  resolveLegacySandboxDispatch,
  type DispatchResult,
} from "./oclif-dispatch";

// ── Global commands (derived from command registry) ──────────────

const GLOBAL_COMMANDS = globalCommandTokens();

type RegistryModule = typeof import("../state/registry");
type RegistryRecoveryModule = typeof import("../registry-recovery-action");
type SandboxConnectModule = typeof import("../actions/sandbox/connect");

let registryModule: RegistryModule | null = null;
let registryRecoveryModule: RegistryRecoveryModule | null = null;
let sandboxConnectModule: SandboxConnectModule | null = null;

function registry(): RegistryModule {
  registryModule ??= require("../state/registry") as RegistryModule;
  return registryModule;
}

function registryRecovery(): RegistryRecoveryModule {
  registryRecoveryModule ??= require("../registry-recovery-action") as RegistryRecoveryModule;
  return registryRecoveryModule;
}

function sandboxConnect(): SandboxConnectModule {
  sandboxConnectModule ??= require("../actions/sandbox/connect") as SandboxConnectModule;
  return sandboxConnectModule;
}

function isPublicSandboxConnectFlag(arg: string | undefined): boolean {
  return sandboxConnect().isSandboxConnectFlag(arg);
}

// ── Commands ─────────────────────────────────────────────────────

async function runOclif(commandId: string, args: string[] = []): Promise<void> {
  await runRegisteredOclifCommand(commandId, args, {
    rootDir: ROOT,
    error: console.error,
    exit: (code: number) => process.exit(code),
  });
}

// ── Dispatch helpers ─────────────────────────────────────────────

function suggestGlobalCommand(token: string): string | null {
  return suggestCommand(token, GLOBAL_COMMANDS);
}

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function findRegisteredSandboxName(tokens: string[]): string | null {
  const registered = new Set(
    registry().listSandboxes().sandboxes.map((s: { name: string }) => s.name),
  );
  return tokens.find((token) => registered.has(token)) || null;
}

function printConnectOrderHint(candidate: string | null): void {
  console.error(`  Command order is: ${CLI_NAME} <sandbox-name> connect`);
  if (candidate) {
    console.error(`  Did you mean: ${CLI_NAME} ${candidate} connect?`);
  }
}

const VALID_SANDBOX_ACTIONS =
  "connect, status, doctor, logs, policy-add, policy-remove, policy-list, hosts-add, hosts-list, hosts-remove, skill, snapshot, share, rebuild, recover, shields, config, channels, gateway-token, destroy";

function printDispatchUsageError(
  result: Extract<DispatchResult, { kind: "usageError" }>,
  sandboxName?: string,
): never {
  if (result.lines.length === 0) {
    help();
    process.exit(1);
  }

  const [usage, ...details] = result.lines;
  console.error(`  Usage: ${CLI_NAME} ${sandboxName ? `${sandboxName} ` : ""}${usage}`);
  for (const line of details) {
    console.error(`    ${line}`);
  }
  process.exit(1);
}

async function runDispatchResult(
  result: DispatchResult,
  opts: { sandboxName?: string; actionArgs?: string[] } = {},
): Promise<void> {
  switch (result.kind) {
    case "oclif":
      await runOclif(result.commandId, result.args);
      return;
    case "help":
      if (result.message) console.error(`  ${result.message}`);
      renderPublicOclifHelp(result.commandId, result.publicUsage, {
        error: typeof result.exitCode === "number" && result.exitCode !== 0,
      });
      if (typeof result.exitCode === "number") process.exit(result.exitCode);
      return;
    case "usageError":
      printDispatchUsageError(result, opts.sandboxName);
    case "unknownAction":
      console.error(`  Unknown action: ${result.action}`);
      console.error(`  Valid actions: ${VALID_SANDBOX_ACTIONS}`);
      process.exit(1);
  }
}

// ── Dispatch ─────────────────────────────────────────────────────

// eslint-disable-next-line complexity
export async function dispatchCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "internal" || argv[0] === "sandbox") {
    await runOclifArgv(argv, {
      rootDir: ROOT,
      error: console.error,
      exit: (code: number) => process.exit(code),
    });
    return;
  }

  const normalized = normalizeArgv(argv, {
    globalCommands: GLOBAL_COMMANDS,
    isSandboxConnectFlag: isPublicSandboxConnectFlag,
  });

  if (normalized.kind === "rootHelp") {
    await runOclif("root:help", []);
    return;
  }

  if (normalized.kind === "dumpCommands") {
    canonicalUsageList().forEach((c: string) => console.log(c));
    return;
  }

  if (normalized.kind === "global") {
    await runDispatchResult(resolveGlobalOclifDispatch(normalized.command, normalized.args));
    return;
  }

  const cmd = normalized.sandboxName;
  const args = argv.slice(1);
  const requestedSandboxAction = normalized.action;
  const requestedSandboxActionArgs = normalized.actionArgs;
  if (normalized.connectHelpRequested) {
    validateName(cmd, "sandbox name");
    sandboxConnect().printSandboxConnectHelp(cmd);
    return;
  }

  // Derived from command registry — single source of truth.
  const sandboxActions = sandboxActionTokens();

  // Help is parser metadata, not sandbox runtime behavior. Render sandbox-scoped
  // legacy help before registry recovery so `nemoclaw missing channels start --help`
  // stays side-effect free and never starts or repairs services.
  if (
    !normalized.connectHelpRequested &&
    sandboxActions.includes(requestedSandboxAction) &&
    hasHelpFlag(requestedSandboxActionArgs)
  ) {
    validateName(cmd, "sandbox name");
    await runDispatchResult(
      resolveLegacySandboxDispatch(cmd, requestedSandboxAction, requestedSandboxActionArgs),
      {
        sandboxName: cmd,
        actionArgs: requestedSandboxActionArgs,
      },
    );
    return;
  }

  // If the registry doesn't know this name but the action is a sandbox-scoped
  // command, attempt recovery — the sandbox may still be live with a stale registry.
  if (!registry().getSandbox(cmd) && sandboxActions.includes(requestedSandboxAction)) {
    validateName(cmd, "sandbox name");
    await registryRecovery().recoverRegistryEntries({ requestedSandboxName: cmd });
    if (!registry().getSandbox(cmd)) {
      if (args.length === 0) {
        const suggestion = suggestGlobalCommand(cmd);
        if (suggestion) {
          console.error(`  Unknown command: ${cmd}`);
          console.error(`  Did you mean: ${CLI_NAME} ${suggestion}?`);
          process.exit(1);
        }
      }
      console.error(`  Sandbox '${cmd}' does not exist.`);
      const allNames = registry().listSandboxes().sandboxes.map((s: { name: string }) => s.name);
      if (allNames.length > 0) {
        console.error("");
        console.error(`  Registered sandboxes: ${allNames.join(", ")}`);
        console.error(`  Run '${CLI_NAME} list' to see all sandboxes.`);
        const reorderedCandidate =
          args[0] === "connect" ? findRegisteredSandboxName(args.slice(1)) : null;
        if (reorderedCandidate) {
          console.error("");
          printConnectOrderHint(reorderedCandidate);
        }
      } else {
        console.error(`  Run '${CLI_NAME} onboard' to create one.`);
      }
      process.exit(1);
    }
  }

  if (!registry().getSandbox(cmd)) {
    const suggestion = suggestGlobalCommand(cmd);
    if (suggestion) {
      console.error(`  Unknown command: ${cmd}`);
      console.error(`  Did you mean: ${CLI_NAME} ${suggestion}?`);
      process.exit(1);
    }
  }

  const sandbox = registry().getSandbox(cmd);
  if (sandbox) {
    validateName(cmd, "sandbox name");
    const action = requestedSandboxAction;
    const actionArgs = requestedSandboxActionArgs;
    if (action === "connect") {
      sandboxConnect().parseSandboxConnectArgs(cmd, actionArgs);
    }
    await runDispatchResult(resolveLegacySandboxDispatch(cmd, action, actionArgs), {
      sandboxName: cmd,
      actionArgs,
    });
    return;
  }

  // Unknown command — suggest
  console.error(`  Unknown command: ${cmd}`);
  console.error("");

  // Check if it looks like a sandbox name with missing action
  const allNames = registry().listSandboxes().sandboxes.map((s: { name: string }) => s.name);
  if (allNames.length > 0) {
    console.error(`  Registered sandboxes: ${allNames.join(", ")}`);
    console.error(`  Try: ${CLI_NAME} <sandbox-name> connect`);
    console.error("");
  }

  console.error(`  Run '${CLI_NAME} help' for usage.`);
  process.exit(1);
}
