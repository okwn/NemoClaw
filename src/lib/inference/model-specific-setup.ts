// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads model-specific setup manifests from the NemoClaw blueprint
 * registry and returns matching OpenClaw compatibility effects.
 *
 * Build-time: generate-openclaw-config.py applies these during image
 * build. Runtime: inference-set.ts calls loadOpenClawModelCompat() when
 * switching models so the patched openclaw.json receives the same compat
 * flags that a fresh build would.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ModelSpecificCompat {
  [key: string]: unknown;
}

interface ManifestMatch {
  modelIds?: string[];
  providerKey?: string;
  inferenceApi?: string;
  baseUrl?: string;
}

interface ManifestEffects {
  openclawCompat?: ModelSpecificCompat;
}

interface Manifest {
  id: string;
  agent: string;
  match: ManifestMatch;
  effects: ManifestEffects;
}

export interface ModelSetupMatchContext {
  model: string;
  providerKey: string;
  inferenceApi: string;
  baseUrl: string;
}

function registrySearchPaths(): string[] {
  const paths: string[] = [];

  const envDir = process.env.NEMOCLAW_MODEL_SPECIFIC_SETUP_DIR;
  if (envDir) paths.push(envDir);

  // Compiled location: dist/lib/inference/model-specific-setup.js
  // Repo root is 3 levels up → nemoclaw-blueprint/model-specific-setup
  const fromModule = path.resolve(__dirname, "..", "..", "..", "nemoclaw-blueprint", "model-specific-setup");
  paths.push(fromModule);

  paths.push(path.resolve(process.cwd(), "nemoclaw-blueprint", "model-specific-setup"));

  return paths;
}

function findRegistryRoot(): string | null {
  for (const candidate of registrySearchPaths()) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

function matchesContext(manifest: Manifest, context: ModelSetupMatchContext): boolean {
  const { match } = manifest;

  if (match.modelIds) {
    const normalizedModel = context.model.trim().toLowerCase();
    if (!match.modelIds.some((id) => id.trim().toLowerCase() === normalizedModel)) return false;
  }

  if (match.providerKey && context.providerKey !== match.providerKey) return false;
  if (match.inferenceApi && context.inferenceApi !== match.inferenceApi) return false;
  if (match.baseUrl && context.baseUrl.replace(/\/+$/, "") !== match.baseUrl.replace(/\/+$/, "")) {
    return false;
  }

  return true;
}

/**
 * Load OpenClaw model-specific compatibility flags for a given
 * model/provider/api/baseUrl context.
 *
 * Returns merged openclawCompat from all matching manifests, or null
 * if no manifests match (or the registry is not found on disk).
 */
export function loadOpenClawModelCompat(
  context: ModelSetupMatchContext,
): ModelSpecificCompat | null {
  const root = findRegistryRoot();
  if (!root) return null;

  const openclawDir = path.join(root, "openclaw");
  let entries: string[];
  try {
    entries = fs.readdirSync(openclawDir).sort();
  } catch {
    return null;
  }

  const merged: ModelSpecificCompat = {};
  let found = false;

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry === "schema.json") continue;
    const filePath = path.join(openclawDir, entry);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const manifest: Manifest = JSON.parse(raw);
      if (manifest.agent !== "openclaw") continue;
      if (!matchesContext(manifest, context)) continue;

      const compat = manifest.effects?.openclawCompat;
      if (compat && typeof compat === "object") {
        Object.assign(merged, compat);
        found = true;
      }
    } catch {
      // Skip manifests that cannot be read or parsed
    }
  }

  return found ? merged : null;
}
