// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import YAML from "yaml";

import { secureTempFile } from "../onboard/temp-files";

/**
 * Build a permissive policy YAML that is guaranteed to be a strict superset
 * of the live sandbox's filesystem policy.
 *
 * Background (#3942, #3957, #3168): OpenShell refuses to remove a
 * `filesystem_policy.read_only` or `filesystem_policy.read_write` entry on a
 * live sandbox. The static `openclaw-sandbox-permissive.yaml` baseline does
 * not see runtime-injected paths — `/proc` on GPU sandboxes, `/opt/hermes`
 * on Hermes, `/home/linuxbrew` on post-#3913 OpenClaw, and any future
 * agent- or feature-specific enrichment. Each of those past mismatches
 * shipped its own permissive-YAML patch. This helper closes the loop by
 * unioning whatever the live sandbox advertises into the permissive YAML
 * before it is applied, so future runtime injections are absorbed
 * automatically.
 *
 * Resolution rules when a path appears on both sides:
 * - Live `read_write` is the more permissive of the two and takes priority:
 *   if the live state writes a path, the permissive transition keeps it
 *   writable, removing it from `read_only` first so we never emit a path
 *   in both lists.
 * - Live `read_only` is merged into base `read_only` only when the same
 *   path is not already granted `read_write` (either by base or by live).
 *
 * Returns the path to a freshly created temp YAML file. Falls back to the
 * base permissive path if the live policy can't be parsed or omits the
 * filesystem section — degrading to the existing static behavior rather
 * than failing closed.
 */
export interface PermissiveRuntimeDeps {
  fetchLivePolicy: (sandboxName: string) => string;
  readBasePolicy: () => string;
}

export function buildRuntimePermissivePolicy(
  sandboxName: string,
  basePermissivePath: string,
  deps: PermissiveRuntimeDeps,
): string {
  const liveRaw = deps.fetchLivePolicy(sandboxName);
  const liveYaml = parsePolicyBlock(liveRaw);
  const live = liveYaml ? safeYamlObject(liveYaml) : null;
  const liveRw = readStringList(live, "read_write");
  const liveRo = readStringList(live, "read_only");

  // No live filesystem section to merge — keep the static path so the
  // caller's apply path is unchanged.
  if (liveRw.length === 0 && liveRo.length === 0) {
    return basePermissivePath;
  }

  const baseYaml = deps.readBasePolicy();
  const base = safeYamlObject(baseYaml);
  if (!base) {
    return basePermissivePath;
  }
  const fsPolicy =
    base.filesystem_policy && typeof base.filesystem_policy === "object"
      ? (base.filesystem_policy as Record<string, unknown>)
      : ((base.filesystem_policy = {} as Record<string, unknown>),
        base.filesystem_policy as Record<string, unknown>);

  const baseRw = new Set(readStringList(base, "read_write"));
  const baseRo = new Set(readStringList(base, "read_only"));

  // RW wins: a live write-path must stay writable in the new policy, and
  // the same path cannot also live in read_only afterwards.
  for (const p of liveRw) {
    baseRo.delete(p);
    baseRw.add(p);
  }
  for (const p of liveRo) {
    if (!baseRw.has(p)) baseRo.add(p);
  }

  fsPolicy.read_write = [...baseRw];
  fsPolicy.read_only = [...baseRo];

  const tmpPath = secureTempFile("nemoclaw-permissive-runtime", ".yaml");
  fs.writeFileSync(tmpPath, YAML.stringify(base), { mode: 0o600 });
  return tmpPath;
}

function safeYamlObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = YAML.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function readStringList(
  root: Record<string, unknown> | null,
  key: "read_only" | "read_write",
): string[] {
  const fsPolicy = root?.filesystem_policy;
  if (!fsPolicy || typeof fsPolicy !== "object") return [];
  const value = (fsPolicy as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

// Lightweight clone of policy/index.ts:parseCurrentPolicy that strips the
// OpenShell header / error preamble before YAML.parse. Inlined to avoid a
// runtime cycle with the policy module.
function parsePolicyBlock(raw: string | null | undefined): string {
  if (!raw) return "";
  const sep = raw.indexOf("---");
  const candidate = (sep === -1 ? raw : raw.slice(sep + 3)).trim();
  if (!candidate) return "";
  if (/^(error|failed|invalid|warning|status)\b/i.test(candidate)) return "";
  if (!/^[a-z_][a-z0-9_]*\s*:/m.test(candidate)) return "";
  try {
    const parsed = YAML.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  } catch {
    return "";
  }
  return candidate;
}
