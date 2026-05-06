// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { resolveLegacySandboxDispatch } from "./oclif-dispatch";

describe("resolveLegacySandboxDispatch", () => {
  it("rewrites simple legacy sandbox actions to oclif command dispatches", () => {
    expect(resolveLegacySandboxDispatch("alpha", "status", [])).toEqual({
      kind: "oclif",
      commandId: "sandbox:status",
      args: ["alpha"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "doctor", ["--json"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:doctor",
      args: ["alpha", "--json"],
    });
  });

  it("rewrites legacy hyphenated actions to oclif-native command ids", () => {
    expect(resolveLegacySandboxDispatch("alpha", "policy-add", ["--from-file"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:policy:add",
      args: ["alpha", "--from-file"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "gateway-token", ["--quiet"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:gateway:token",
      args: ["alpha", "--quiet"],
    });
  });

  it("keeps legacy public help usage for sandbox-scoped commands", () => {
    expect(resolveLegacySandboxDispatch("alpha", "status", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:status",
      publicUsage: "<name> status",
    });
    expect(resolveLegacySandboxDispatch("alpha", "logs", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:logs",
      publicUsage: "<name> logs [--follow] [--tail <lines>|-n <lines>] [--since <duration>]",
    });
  });

  it("rewrites nested sandbox subcommands and defaults", () => {
    expect(resolveLegacySandboxDispatch("alpha", "channels", [])).toEqual({
      kind: "oclif",
      commandId: "sandbox:channels:list",
      args: ["alpha"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "channels", ["add", "slack"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:channels:add",
      args: ["alpha", "slack"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "snapshot", ["restore", "latest"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:snapshot:restore",
      args: ["alpha", "latest"],
    });
  });

  it("falls back to parent commands that intentionally own unknown subcommands and custom help", () => {
    expect(resolveLegacySandboxDispatch("alpha", "skill", ["install", "--help"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:skill",
      args: ["alpha", "install", "--help"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "skill", ["bogus"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:skill",
      args: ["alpha", "bogus"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "snapshot", ["bogus"])).toEqual({
      kind: "oclif",
      commandId: "sandbox:snapshot",
      args: ["alpha", "bogus"],
    });
  });

  it("preserves legacy usage errors for config and shields groups", () => {
    expect(resolveLegacySandboxDispatch("alpha", "config", ["bogus"])).toEqual({
      kind: "usageError",
      lines: ["config get [--key dotpath] [--format json|yaml]"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "shields", ["bogus"])).toEqual({
      kind: "usageError",
      lines: [
        "shields <down|up|status>",
        "  down  [--timeout 5m] [--reason 'text'] [--policy permissive]",
        "  up    Restore policy from snapshot",
        "  status  Show current shields state",
      ],
    });
  });

  it("reports channel subcommand and action errors", () => {
    expect(resolveLegacySandboxDispatch("alpha", "channels", ["bogus"])).toEqual({
      kind: "unknownSubcommand",
      command: "channels",
      subcommand: "bogus",
    });
    expect(resolveLegacySandboxDispatch("alpha", "bogus", [])).toEqual({
      kind: "unknownAction",
      action: "bogus",
    });
  });
});
