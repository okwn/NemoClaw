// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";

import { NemoClawCommand } from "../cli/nemoclaw-oclif-command";

import { getVersion } from "../core/version";
import { buildVersionedUninstallUrl, runUninstallCommand } from "../uninstall-command";

export default class UninstallCliCommand extends NemoClawCommand {
  static id = "uninstall";
  static strict = false;
  static summary = "Run uninstall.sh";
  static description = "Run the local uninstall.sh script; remote fallback is disabled.";
  static usage = ["uninstall [flags]"];
  static examples = ["<%= config.bin %> uninstall --yes"];
  static display = [
    {
      // Keep the usage global even under the nemohermes alias; `nemohermes uninstall`
      // is the package uninstaller, not a sandbox-scoped action.
      usage: "nemoclaw uninstall",
      description: "Run uninstall.sh (local only; no remote fallback)",
      group: "Cleanup",
      scope: "global",
      order: 43,
    },
  ];
  static flags = {
  };

  public async run(): Promise<void> {
    this.parsed = true;
    runUninstallCommand({
      args: this.argv,
      rootDir: this.config.root,
      currentDir: __dirname,
      remoteScriptUrl: buildVersionedUninstallUrl(getVersion()),
      env: process.env,
      spawnSyncImpl: spawnSync,
      log: console.log,
      error: console.error,
      exit: (code: number): never => {
        this.setExitCode(code);
        return undefined as never;
      },
    });
  }
}
