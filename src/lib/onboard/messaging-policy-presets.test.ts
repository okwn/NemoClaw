// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  mergeRequiredMessagingChannelPolicyPresets,
  requiredMessagingChannelPolicyPresets,
} from "./messaging-policy-presets";

describe("messaging policy presets", () => {
  it("maps Slack messaging to the Slack network policy preset", () => {
    expect(requiredMessagingChannelPolicyPresets(["slack"])).toEqual(["slack"]);
    expect(requiredMessagingChannelPolicyPresets([" Slack "])).toEqual(["slack"]);
  });

  it("merges required messaging presets into an existing selection", () => {
    expect(mergeRequiredMessagingChannelPolicyPresets(["npm", "pypi"], ["slack"])).toEqual([
      "npm",
      "pypi",
      "slack",
    ]);
  });

  it("does not add a required preset that is not available to the sandbox", () => {
    expect(
      mergeRequiredMessagingChannelPolicyPresets(["npm"], ["slack"], new Set(["npm"])),
    ).toEqual(["npm"]);
  });
});
