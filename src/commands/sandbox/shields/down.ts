// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import Command from "../../../lib/commands/sandbox/shields/down";
import { withCommandDisplay } from "../../../lib/cli/command-display";

export default withCommandDisplay(Command, [
  {
    usage: "nemoclaw <name> shields down",
    description: "Lower sandbox security shields",
    flags: "[--timeout 5m] [--reason <text>] [--policy permissive]",
    group: "Sandbox Management",
    hidden: true,
    scope: "sandbox",
    order: 25,
  },
]);
