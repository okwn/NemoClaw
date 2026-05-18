// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  nativeArgvForOclifDispatch,
  resolveGlobalOclifDispatch,
  resolveLegacySandboxDispatch,
} from "./oclif-dispatch";
import { SANDBOX_ROUTE_OVERRIDES, sandboxRouteTokens } from "./public-route-metadata";

describe("public route/display separation", () => {
  it("keeps dispatch token selection independent from public display usage text", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "src/lib/cli/oclif-dispatch.ts"), "utf-8");
    const registrySource = fs.readFileSync(path.join(process.cwd(), "src/lib/cli/command-registry.ts"), "utf-8");

    expect(dispatchSource).not.toMatch(/TokensFromUsage|literalTokensFromUsage/);
    expect(dispatchSource).not.toMatch(/legacyTokens:\s*.*\.usage/);
    expect(registrySource).not.toMatch(/rest\s*=\s*cmd\.usage/);
  });

  it("keeps explicit compatibility route overrides limited to non-derivable public spellings", () => {
    expect(Object.keys(SANDBOX_ROUTE_OVERRIDES).sort()).toEqual([
      "sandbox:gateway:token",
      "sandbox:hosts:add",
      "sandbox:hosts:list",
      "sandbox:hosts:remove",
      "sandbox:policy:add",
      "sandbox:policy:list",
      "sandbox:policy:remove",
    ]);
    expect(sandboxRouteTokens("sandbox:gateway:token")).toEqual(["gateway-token"]);
    expect(sandboxRouteTokens("sandbox:config:rotate-token")).toEqual(["config", "rotate-token"]);
  });
});

describe("nativeArgvForOclifDispatch", () => {
  it("translates resolved command IDs and parser args to native oclif argv", () => {
    expect(
      nativeArgvForOclifDispatch({
        kind: "oclif",
        commandId: "sandbox:config:set",
        args: ["alpha", "--key", "model", "--value", "nvidia/nemotron"],
      }),
    ).toEqual(["sandbox", "config", "set", "alpha", "--key", "model", "--value", "nvidia/nemotron"]);
    expect(
      nativeArgvForOclifDispatch({
        kind: "oclif",
        commandId: "inference:get",
        args: ["--json"],
      }),
    ).toEqual(["inference", "get", "--json"]);
  });
});

describe("resolveGlobalOclifDispatch", () => {
  it("routes simple and nested global commands through oclif", () => {
    expect(resolveGlobalOclifDispatch("list", ["--json"])).toEqual({
      kind: "oclif",
      commandId: "list",
      args: ["--json"],
    });
    expect(resolveGlobalOclifDispatch("update", ["--check"])).toEqual({
      kind: "oclif",
      commandId: "update",
      args: ["--check"],
    });
    expect(resolveGlobalOclifDispatch("tunnel", ["start"])).toEqual({
      kind: "oclif",
      commandId: "tunnel:start",
      args: [],
    });
    expect(resolveGlobalOclifDispatch("inference", ["set", "--provider", "nvidia-prod"])).toEqual({
      kind: "oclif",
      commandId: "inference:set",
      args: ["--provider", "nvidia-prod"],
    });
    expect(resolveGlobalOclifDispatch("inference", ["get", "--json"])).toEqual({
      kind: "oclif",
      commandId: "inference:get",
      args: ["--json"],
    });
    expect(resolveGlobalOclifDispatch("--version", [])).toEqual({
      kind: "oclif",
      commandId: "root:version",
      args: [],
    });
    expect(resolveGlobalOclifDispatch("version", [])).toEqual({
      kind: "oclif",
      commandId: "root:version",
      args: [],
    });
  });

  it("returns metadata-derived parent help for unsupported global forms", () => {
    expect(resolveGlobalOclifDispatch("tunnel", ["restart"])).toEqual({
      kind: "help",
      commandId: "tunnel",
      publicUsage: ["tunnel start", "tunnel stop"],
      exitCode: 1,
      message: "Unknown tunnel subcommand: restart",
    });
    expect(resolveGlobalOclifDispatch("inference", ["bogus"])).toEqual({
      kind: "help",
      commandId: "inference",
      publicUsage: [
        "inference get [--json]",
        "inference set --provider <provider> --model <model> [--sandbox <name>] [--no-verify]",
      ],
      exitCode: 1,
      message: "Unknown inference subcommand: bogus",
    });
    expect(resolveGlobalOclifDispatch("credentials", ["bogus"])).toEqual({
      kind: "help",
      commandId: "credentials",
      publicUsage: ["credentials list", "credentials reset <PROVIDER> [--yes|-y]"],
      exitCode: 1,
      message: "Unknown credentials subcommand: bogus",
    });
    expect(resolveGlobalOclifDispatch("bogus", [])).toEqual({ kind: "usageError", lines: [] });
  });
});

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

  it("rewrites sandbox recover through metadata-derived dispatch", () => {
    expect(resolveLegacySandboxDispatch("alpha", "recover", [])).toEqual({
      kind: "oclif",
      commandId: "sandbox:recover",
      args: ["alpha"],
    });
    expect(resolveLegacySandboxDispatch("alpha", "recover", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:recover",
      publicUsage: "<name> recover",
    });
  });

  it("rewrites config actions through command-id-derived dispatch", () => {
    expect(
      resolveLegacySandboxDispatch("alpha", "config", [
        "set",
        "--key",
        "inference.endpoints",
        "--value",
        "HTTP://93.184.216.34/v1",
        "--config-accept-new-path",
      ]),
    ).toEqual({
      kind: "oclif",
      commandId: "sandbox:config:set",
      args: [
        "alpha",
        "--key",
        "inference.endpoints",
        "--value",
        "HTTP://93.184.216.34/v1",
        "--config-accept-new-path",
      ],
    });
    expect(
      resolveLegacySandboxDispatch("alpha", "config", ["rotate-token", "--from-env", "TOKEN"]),
    ).toEqual({
      kind: "oclif",
      commandId: "sandbox:config:rotate-token",
      args: ["alpha", "--from-env", "TOKEN"],
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

  it("keeps share parent help public", () => {
    expect(resolveLegacySandboxDispatch("alpha", "share", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:share",
      publicUsage: "<name> share <mount|unmount|status>",
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

  it("returns metadata-derived parent help for config and shields groups", () => {
    expect(resolveLegacySandboxDispatch("alpha", "config", ["bogus"])).toEqual({
      kind: "help",
      commandId: "sandbox:config",
      exitCode: 1,
      message: "Unknown config subcommand: bogus",
      publicUsage: [
        "<name> config get [--key <dotpath>] [--format json|yaml]",
        "<name> config set --key <dotpath> --value <value> [--restart] [--config-accept-new-path]",
        "<name> config rotate-token",
      ],
    });
    expect(resolveLegacySandboxDispatch("alpha", "shields", ["bogus"])).toEqual({
      kind: "help",
      commandId: "sandbox:shields",
      exitCode: 1,
      message: "Unknown shields subcommand: bogus",
      publicUsage: [
        "<name> shields down [--timeout 5m] [--reason <text>] [--policy permissive]",
        "<name> shields up",
        "<name> shields status",
      ],
    });
  });

  it("reports channel subcommand errors from metadata-derived parent routes", () => {
    expect(resolveLegacySandboxDispatch("alpha", "channels", ["bogus"])).toEqual({
      kind: "help",
      commandId: "sandbox:channels",
      exitCode: 1,
      message: "Unknown channels subcommand: bogus",
      publicUsage: [
        "<name> channels list",
        "<name> channels add <channel> [--dry-run]",
        "<name> channels remove <channel> [--dry-run]",
        "<name> channels stop <channel> [--dry-run]",
        "<name> channels start <channel> [--dry-run]",
      ],
    });
    expect(resolveLegacySandboxDispatch("alpha", "bogus", [])).toEqual({
      kind: "unknownAction",
      action: "bogus",
    });
  });
});
