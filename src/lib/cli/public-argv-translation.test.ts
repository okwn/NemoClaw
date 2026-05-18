// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  translatePublicGlobalArgv,
  translatePublicSandboxArgv,
  type DispatchResult,
} from "./public-argv-translation";
import { SANDBOX_ROUTE_OVERRIDES, sandboxRouteTokens } from "./public-route-metadata";

function expectNative(
  result: DispatchResult,
  commandId: string,
  args: string[],
  argv = [...commandId.split(":"), ...args],
): void {
  expect(result).toEqual({
    kind: "nativeArgv",
    commandId,
    args,
    argv,
  });
}

describe("public route/display separation", () => {
  afterEach(() => {
    vi.doUnmock("./oclif-metadata");
    vi.resetModules();
  });

  it("keeps dispatch token selection independent from public display usage text", async () => {
    vi.resetModules();
    vi.doMock("./oclif-metadata", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./oclif-metadata")>();
      const realMetadata = actual.getRegisteredOclifCommandsMetadata();
      const withUsage = (commandId: string, usage: string) => {
        const metadata = realMetadata[commandId];
        const displayEntry = metadata.publicDisplay?.[0] ?? metadata.display?.[0];
        return {
          ...metadata,
          publicDisplay: displayEntry ? [{ ...displayEntry, usage }] : [],
        };
      };
      const metadata: ReturnType<typeof actual.getRegisteredOclifCommandsMetadata> = {
        ...realMetadata,
        list: withUsage("list", "nemoclaw renamed-list"),
        "sandbox:status": withUsage("sandbox:status", "nemoclaw <name> renamed-status"),
      };
      return {
        ...actual,
        getRegisteredOclifCommandMetadata: (commandId: string) => metadata[commandId] ?? null,
        getRegisteredOclifCommandSummary: (commandId: string) =>
          metadata[commandId]?.summary ?? null,
        getRegisteredOclifCommandsMetadata: () => metadata,
      };
    });

    const dispatch = await import("./public-argv-translation");
    const registry = await import("./command-registry");

    expectNative(dispatch.translatePublicGlobalArgv("list", []), "list", []);
    expect(dispatch.translatePublicGlobalArgv("renamed-list", [])).toEqual({
      kind: "usageError",
      lines: [],
    });
    expectNative(
      dispatch.translatePublicSandboxArgv("alpha", "status", []),
      "sandbox:status",
      ["alpha"],
    );
    expect(dispatch.translatePublicSandboxArgv("alpha", "renamed-status", [])).toEqual({
      kind: "unknownAction",
      action: "renamed-status",
    });

    expect(registry.globalCommandTokens()).toContain("list");
    expect(registry.globalCommandTokens()).not.toContain("renamed-list");
    expect(registry.sandboxActionTokens()).toContain("status");
    expect(registry.sandboxActionTokens()).not.toContain("renamed-status");
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

describe("translatePublicGlobalArgv", () => {
  it("translates simple and nested global commands to native oclif argv", () => {
    expectNative(translatePublicGlobalArgv("list", ["--json"]), "list", ["--json"]);
    expectNative(translatePublicGlobalArgv("update", ["--check"]), "update", ["--check"]);
    expectNative(translatePublicGlobalArgv("tunnel", ["start"]), "tunnel:start", []);
    expectNative(
      translatePublicGlobalArgv("inference", ["set", "--provider", "nvidia-prod"]),
      "inference:set",
      ["--provider", "nvidia-prod"],
    );
    expectNative(translatePublicGlobalArgv("inference", ["get", "--json"]), "inference:get", ["--json"]);
    expectNative(translatePublicGlobalArgv("--version", []), "root:version", []);
    expectNative(translatePublicGlobalArgv("version", []), "root:version", []);
  });

  it("returns metadata-derived parent help for unsupported global forms", () => {
    expect(translatePublicGlobalArgv("tunnel", ["restart"])).toEqual({
      kind: "help",
      commandId: "tunnel",
      publicUsage: ["tunnel start", "tunnel stop"],
      exitCode: 1,
      message: "Unknown tunnel subcommand: restart",
    });
    expect(translatePublicGlobalArgv("inference", ["bogus"])).toEqual({
      kind: "help",
      commandId: "inference",
      publicUsage: [
        "inference get [--json]",
        "inference set --provider <provider> --model <model> [--sandbox <name>] [--no-verify]",
      ],
      exitCode: 1,
      message: "Unknown inference subcommand: bogus",
    });
    expect(translatePublicGlobalArgv("credentials", ["bogus"])).toEqual({
      kind: "help",
      commandId: "credentials",
      publicUsage: ["credentials list", "credentials reset <PROVIDER> [--yes|-y]"],
      exitCode: 1,
      message: "Unknown credentials subcommand: bogus",
    });
    expect(translatePublicGlobalArgv("bogus", [])).toEqual({ kind: "usageError", lines: [] });
  });
});

describe("public help compatibility cases", () => {
  it("keeps public-grammar help for supported compatibility islands", () => {
    expect(translatePublicGlobalArgv("credentials", ["bogus"])).toEqual({
      kind: "help",
      commandId: "credentials",
      publicUsage: ["credentials list", "credentials reset <PROVIDER> [--yes|-y]"],
      exitCode: 1,
      message: "Unknown credentials subcommand: bogus",
    });
    expect(translatePublicSandboxArgv("alpha", "status", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:status",
      publicUsage: "<name> status",
    });
    expect(translatePublicSandboxArgv("alpha", "share", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:share",
      publicUsage: "<name> share <mount|unmount|status>",
    });
    expect(translatePublicSandboxArgv("alpha", "channels", ["bogus"])).toEqual({
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
  });
});

describe("translatePublicSandboxArgv", () => {
  it("translates simple legacy sandbox actions to native oclif argv", () => {
    expectNative(translatePublicSandboxArgv("alpha", "status", []), "sandbox:status", ["alpha"]);
    expectNative(
      translatePublicSandboxArgv("alpha", "doctor", ["--json"]),
      "sandbox:doctor",
      ["alpha", "--json"],
    );
  });

  it("translates legacy hyphenated actions to native oclif argv", () => {
    expectNative(
      translatePublicSandboxArgv("alpha", "policy-add", ["--from-file"]),
      "sandbox:policy:add",
      ["alpha", "--from-file"],
    );
    expectNative(
      translatePublicSandboxArgv("alpha", "gateway-token", ["--quiet"]),
      "sandbox:gateway:token",
      ["alpha", "--quiet"],
    );
  });

  it("keeps legacy public help usage for sandbox-scoped commands", () => {
    expect(translatePublicSandboxArgv("alpha", "status", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:status",
      publicUsage: "<name> status",
    });
    expect(translatePublicSandboxArgv("alpha", "logs", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:logs",
      publicUsage: "<name> logs [--follow] [--tail <lines>|-n <lines>] [--since <duration>]",
    });
  });

  it("translates sandbox recover through metadata-derived dispatch", () => {
    expectNative(translatePublicSandboxArgv("alpha", "recover", []), "sandbox:recover", ["alpha"]);
    expect(translatePublicSandboxArgv("alpha", "recover", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:recover",
      publicUsage: "<name> recover",
    });
  });

  it("translates config actions through command-id-derived dispatch", () => {
    expectNative(
      translatePublicSandboxArgv("alpha", "config", [
        "set",
        "--key",
        "inference.endpoints",
        "--value",
        "HTTP://93.184.216.34/v1",
        "--config-accept-new-path",
      ]),
      "sandbox:config:set",
      [
        "alpha",
        "--key",
        "inference.endpoints",
        "--value",
        "HTTP://93.184.216.34/v1",
        "--config-accept-new-path",
      ],
    );
    expectNative(
      translatePublicSandboxArgv("alpha", "config", ["rotate-token", "--from-env", "TOKEN"]),
      "sandbox:config:rotate-token",
      ["alpha", "--from-env", "TOKEN"],
    );
  });

  it("translates nested sandbox subcommands and defaults", () => {
    expectNative(translatePublicSandboxArgv("alpha", "channels", []), "sandbox:channels:list", ["alpha"]);
    expectNative(
      translatePublicSandboxArgv("alpha", "channels", ["add", "slack"]),
      "sandbox:channels:add",
      ["alpha", "slack"],
    );
    expectNative(
      translatePublicSandboxArgv("alpha", "snapshot", ["restore", "latest"]),
      "sandbox:snapshot:restore",
      ["alpha", "latest"],
    );
  });

  it("keeps share parent help public", () => {
    expect(translatePublicSandboxArgv("alpha", "share", ["--help"])).toEqual({
      kind: "help",
      commandId: "sandbox:share",
      publicUsage: "<name> share <mount|unmount|status>",
    });
  });

  it("falls back to parent commands that intentionally own unknown subcommands and custom help", () => {
    expectNative(
      translatePublicSandboxArgv("alpha", "skill", ["install", "--help"]),
      "sandbox:skill",
      ["alpha", "install", "--help"],
    );
    expectNative(
      translatePublicSandboxArgv("alpha", "skill", ["bogus"]),
      "sandbox:skill",
      ["alpha", "bogus"],
    );
    expectNative(
      translatePublicSandboxArgv("alpha", "snapshot", ["bogus"]),
      "sandbox:snapshot",
      ["alpha", "bogus"],
    );
  });

  it("returns metadata-derived parent help for config and shields groups", () => {
    expect(translatePublicSandboxArgv("alpha", "config", ["bogus"])).toEqual({
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
    expect(translatePublicSandboxArgv("alpha", "shields", ["bogus"])).toEqual({
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
    expect(translatePublicSandboxArgv("alpha", "channels", ["bogus"])).toEqual({
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
    expect(translatePublicSandboxArgv("alpha", "bogus", [])).toEqual({
      kind: "unknownAction",
      action: "bogus",
    });
  });
});
