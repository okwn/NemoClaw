// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { NemoClawCommand } from "../cli/nemoclaw-oclif-command";

import { runOnboardAction } from "../actions/global";
import {
  buildOnboardFlags,
  onboardExamples,
  type OnboardFlags,
  onboardUsage,
  toLegacyOnboardArgs,
} from "./onboard/common";

export default class OnboardCliCommand extends NemoClawCommand {
  static id = "onboard";
  static strict = true;
  static summary = "Configure inference endpoint and credentials";
  static description = "Configure inference, credentials, and sandbox settings.";
  static usage = onboardUsage;
  static examples = onboardExamples;
  static display = [
    {
      usage: "nemoclaw onboard",
      description: "Configure inference endpoint and credentials",
      group: "Getting Started",
      scope: "global",
      order: 0,
    },
    {
      usage: "nemoclaw onboard --from",
      description: "Use a custom Dockerfile for the sandbox image",
      group: "Getting Started",
      scope: "global",
      order: 1,
    },
  ];
  static flags = buildOnboardFlags();

  public async run(): Promise<void> {
    const { flags } = await this.parse(OnboardCliCommand);
    await runOnboardAction(toLegacyOnboardArgs(flags as OnboardFlags));
  }
}
