// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/* v8 ignore start -- thin oclif adapter covered through CLI integration tests. */

import { Args, Command, Flags } from "@oclif/core";

type RuntimeBridge = {
  sandboxConnect: (sandboxName: string) => Promise<void>;
};

function getRuntimeBridge(): RuntimeBridge {
  return require("../nemoclaw") as RuntimeBridge;
}

export default class ConnectCliCommand extends Command {
  static id = "sandbox:connect";
  static strict = true;
  static summary = "Shell into a running sandbox";
  static description = "Connect to a running sandbox.";
  static usage = ["<name> connect"];
  static args = {
    sandboxName: Args.string({ name: "sandbox", description: "Sandbox name", required: true }),
  };
  static flags = {
    help: Flags.help({ char: "h" }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(ConnectCliCommand);
    await getRuntimeBridge().sandboxConnect(args.sandboxName);
  }
}
