// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Args } from "@oclif/core";
import { NemoClawCommand } from "../cli/nemoclaw-oclif-command";

import { runDeployAction } from "../actions/global";

export default class DeployCliCommand extends NemoClawCommand {
  static id = "deploy";
  static strict = true;
  static summary = "Deprecated Brev-specific bootstrap path";
  static description = "Deprecated compatibility command for Brev-specific deployment.";
  static usage = ["deploy [instance-name]"];
  static examples = ["<%= config.bin %> deploy my-gpu-instance"];
  static display = [
    {
      usage: "nemoclaw deploy",
      description: "Deprecated Brev-specific bootstrap path",
      group: "Compatibility Commands",
      deprecated: true,
      scope: "global",
      order: 31,
    },
  ];
  static args = {
    instanceName: Args.string({
      name: "instance-name",
      description: "Brev instance name",
      required: false,
    }),
  };
  static flags = {
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(DeployCliCommand);
    await runDeployAction(args.instanceName);
  }
}
