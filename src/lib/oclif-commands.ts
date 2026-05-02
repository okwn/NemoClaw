// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  CredentialsCommand,
  CredentialsListCommand,
  CredentialsResetCommand,
} from "./credentials-cli-command";
import DebugCliCommand from "./debug-cli-command";
import GatewayTokenCliCommand from "./gateway-token-cli-command";
import ListCommand from "./list-command";
import {
  SandboxChannelsListCommand,
  SandboxConfigGetCommand,
  SandboxPolicyListCommand,
  SandboxStatusCommand,
} from "./sandbox-inspection-cli-command";
import ShareCommand from "./share-command";
import StatusCommand from "./status-command";
import {
  DeprecatedStartCommand,
  DeprecatedStopCommand,
  TunnelStartCommand,
  TunnelStopCommand,
} from "./tunnel-commands";
import UninstallCliCommand from "./uninstall-cli-command";

export default {
  credentials: CredentialsCommand,
  "credentials:list": CredentialsListCommand,
  "credentials:reset": CredentialsResetCommand,
  debug: DebugCliCommand,
  list: ListCommand,
  "sandbox:channels:list": SandboxChannelsListCommand,
  "sandbox:config:get": SandboxConfigGetCommand,
  "sandbox:policy-list": SandboxPolicyListCommand,
  "sandbox:status": SandboxStatusCommand,
  share: ShareCommand,
  status: StatusCommand,
  start: DeprecatedStartCommand,
  stop: DeprecatedStopCommand,
  "sandbox:gateway-token": GatewayTokenCliCommand,
  "tunnel:start": TunnelStartCommand,
  "tunnel:stop": TunnelStopCommand,
  uninstall: UninstallCliCommand,
};
