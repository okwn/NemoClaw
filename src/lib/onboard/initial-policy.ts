// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import YAML from "yaml";

import * as policies from "../policy";
import { cleanupTempDir, secureTempFile } from "./temp-files";

export type InitialSandboxPolicy = {
  policyPath: string;
  appliedPresets: string[];
  cleanup?: () => boolean;
};

const CREATE_TIME_POLICY_PRESETS_BY_CHANNEL: Record<string, string[]> = {
  slack: ["slack"],
};

export function getNetworkPolicyNames(policyContent: string): Set<string> | null {
  try {
    const parsed = YAML.parse(policyContent);
    const networkPolicies = parsed?.network_policies;
    if (
      !networkPolicies ||
      typeof networkPolicies !== "object" ||
      Array.isArray(networkPolicies)
    ) {
      return new Set();
    }
    return new Set(Object.keys(networkPolicies));
  } catch {
    return null;
  }
}

export function prepareInitialSandboxCreatePolicy(
  basePolicyPath: string,
  activeMessagingChannels: string[],
): InitialSandboxPolicy {
  const requestedCreateTimePresets = [
    ...new Set(
      activeMessagingChannels.flatMap(
        (channel) => CREATE_TIME_POLICY_PRESETS_BY_CHANNEL[channel] || [],
      ),
    ),
  ];

  if (requestedCreateTimePresets.length === 0) {
    return { policyPath: basePolicyPath, appliedPresets: [] };
  }

  const basePolicy = fs.readFileSync(basePolicyPath, "utf-8");
  const basePolicyNames = getNetworkPolicyNames(basePolicy);
  if (basePolicyNames === null) {
    return { policyPath: basePolicyPath, appliedPresets: [] };
  }
  const existingCreateTimePresets = requestedCreateTimePresets.filter((preset) =>
    basePolicyNames.has(preset),
  );
  const createTimePresets = requestedCreateTimePresets.filter(
    (preset) => !basePolicyNames.has(preset),
  );
  if (createTimePresets.length === 0) {
    return { policyPath: basePolicyPath, appliedPresets: existingCreateTimePresets };
  }

  const mergedPolicy = policies.mergePresetNamesIntoPolicy(basePolicy, createTimePresets);
  if (mergedPolicy.missingPresets.length > 0) {
    throw new Error(
      `Cannot prepare sandbox create policy; missing policy preset(s): ${mergedPolicy.missingPresets.join(", ")}`,
    );
  }

  const policyPath = secureTempFile("nemoclaw-initial-policy", ".yaml");
  fs.writeFileSync(policyPath, mergedPolicy.policy, { encoding: "utf-8", mode: 0o600 });

  return {
    policyPath,
    appliedPresets: [...existingCreateTimePresets, ...mergedPolicy.appliedPresets],
    cleanup: () => {
      try {
        cleanupTempDir(policyPath, "nemoclaw-initial-policy");
        return true;
      } catch {
        return false;
      }
    },
  };
}
