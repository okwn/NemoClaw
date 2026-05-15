// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getVersion } from "../../../dist/lib/core/version";

describe("lib/version", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "version-test-"));
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("uses git describe tags when available", () => {
    const gitDir = mkdtempSync(join(tmpdir(), "version-git-test-"));
    try {
      writeFileSync(join(gitDir, "package.json"), JSON.stringify({ version: "0.0.0" }));
      execFileSync("git", ["init"], { cwd: gitDir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: gitDir });
      execFileSync("git", ["config", "user.name", "Tests"], { cwd: gitDir });
      writeFileSync(join(gitDir, "README.md"), "test\n");
      execFileSync("git", ["add", "README.md"], { cwd: gitDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: gitDir, stdio: "ignore" });
      execFileSync("git", ["tag", "--no-sign", "v9.8.7"], { cwd: gitDir });
      expect(getVersion({ rootDir: gitDir })).toBe("9.8.7");
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });

  it("falls back to package.json version when no git and no .version", () => {
    expect(getVersion({ rootDir: testDir })).toBe("1.2.3");
  });

  it("prefers .version file over package.json", () => {
    writeFileSync(join(testDir, ".version"), "0.5.0-rc1\n");
    const result = getVersion({ rootDir: testDir });
    expect(result).toBe("0.5.0-rc1");
    rmSync(join(testDir, ".version"));
  });

  it("regression #1239: returns .version even when package.json is stale", () => {
    // npm-published tarballs ship with a stale package.json version (0.1.0)
    // and a .version file stamped from the git tag at publish time. The
    // installed CLI must report the .version contents, not the package.json
    // semver. See issue #1239.
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
    writeFileSync(join(testDir, ".version"), "0.0.2");
    expect(getVersion({ rootDir: testDir })).toBe("0.0.2");
    rmSync(join(testDir, ".version"));
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
  });

  it("throws when package.json does not expose a string version", () => {
    const invalidDir = mkdtempSync(join(tmpdir(), "version-invalid-test-"));
    try {
      writeFileSync(join(invalidDir, "package.json"), JSON.stringify({ name: "missing-version" }));
      expect(() => getVersion({ rootDir: invalidDir })).toThrow(/missing a string version field/);
    } finally {
      rmSync(invalidDir, { recursive: true, force: true });
    }
  });

  it("returns a string", () => {
    expect(typeof getVersion({ rootDir: testDir })).toBe("string");
  });
});
