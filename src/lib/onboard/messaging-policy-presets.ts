// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const REQUIRED_POLICY_PRESETS_BY_MESSAGING_CHANNEL: Record<string, readonly string[]> = {
  slack: ["slack"],
};

export function requiredMessagingChannelPolicyPresets(
  channels: string[] | null | undefined,
): string[] {
  if (!Array.isArray(channels)) return [];
  const required: string[] = [];
  for (const rawChannel of channels) {
    if (typeof rawChannel !== "string") continue;
    const channel = rawChannel.trim().toLowerCase();
    for (const preset of REQUIRED_POLICY_PRESETS_BY_MESSAGING_CHANNEL[channel] || []) {
      if (!required.includes(preset)) required.push(preset);
    }
  }
  return required;
}

export function mergeRequiredMessagingChannelPolicyPresets(
  selectedPresets: string[],
  channels: string[] | null | undefined,
  knownPresetNames?: Iterable<string> | null,
): string[] {
  const merged = [...selectedPresets];
  const selected = new Set(merged);
  const known = knownPresetNames ? new Set(knownPresetNames) : null;

  for (const preset of requiredMessagingChannelPolicyPresets(channels)) {
    if (known && !known.has(preset)) continue;
    if (selected.has(preset)) continue;
    merged.push(preset);
    selected.add(preset);
  }

  return merged;
}
