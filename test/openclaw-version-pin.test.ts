// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");
const DUPLICATE_MESSAGE_FIX_VERSION = "2026.4.25";

function versionGte(left: string, right: string): boolean {
  const lhs = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rhs = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(lhs.length, rhs.length);
  for (let index = 0; index < length; index += 1) {
    const a = lhs[index] ?? 0;
    const b = rhs[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function matchVersion(contents: string, regex: RegExp, label: string): string {
  const match = contents.match(regex);
  if (!match?.[1]) throw new Error(`Could not parse ${label}`);
  return match[1];
}

describe("OpenClaw version pin", () => {
  it("pins fresh and rebuilt OpenClaw sandboxes to a version with the duplicate-message fix (#3789)", () => {
    const dockerfileVersion = matchVersion(
      readText("Dockerfile.base"),
      /^ARG OPENCLAW_VERSION=([0-9.]+)$/m,
      "Dockerfile.base OPENCLAW_VERSION",
    );
    const minimumVersion = matchVersion(
      readText("nemoclaw-blueprint/blueprint.yaml"),
      /^min_openclaw_version:\s*"?([0-9.]+)"?$/m,
      "blueprint min_openclaw_version",
    );
    const manifestVersion = matchVersion(
      readText("agents/openclaw/manifest.yaml"),
      /^expected_version:\s*"([0-9.]+)"$/m,
      "OpenClaw manifest expected_version",
    );

    for (const [label, version] of [
      ["Dockerfile.base OPENCLAW_VERSION", dockerfileVersion],
      ["blueprint min_openclaw_version", minimumVersion],
      ["OpenClaw manifest expected_version", manifestVersion],
    ] as const) {
      expect(versionGte(version, DUPLICATE_MESSAGE_FIX_VERSION), `${label}=${version}`).toBe(true);
    }
    expect(new Set([dockerfileVersion, minimumVersion, manifestVersion]).size).toBe(1);
  });
});
