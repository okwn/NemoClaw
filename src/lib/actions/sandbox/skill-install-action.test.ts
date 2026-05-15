// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSandboxSkill,
  looksLikeOpenClawPlugin,
  printSkillInstallUsage,
} from "../../../../dist/lib/actions/sandbox/skill-install";

describe("sandbox skill install action", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = join(tmpdir(), `nemoclaw-skill-action-${process.pid}-${tempDirs.length}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  function mockExit() {
    return vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);
  }

  it("prints skill install usage", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    printSkillInstallUsage();
    expect(log.mock.calls.flat().join("\n")).toContain("skill install <path>");
  });

  it("detects OpenClaw plugin markers", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openclaw.plugin.json"), "{}");
    expect(looksLikeOpenClawPlugin(dir)).toBe(true);
  });

  it("detects OpenClaw plugin package metadata", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ openclaw: { extensions: ["./dist/index.js"] } }));
    expect(looksLikeOpenClawPlugin(join(dir, "missing.md"))).toBe(true);
  });

  it("ignores invalid package metadata", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), "{");
    expect(looksLikeOpenClawPlugin(dir)).toBe(false);
    expect(looksLikeOpenClawPlugin(join(dir, "missing.md"))).toBe(false);
  });

  it("prints usage for help forms", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await installSandboxSkill("alpha", []);
    await installSandboxSkill("alpha", ["help"]);
    await installSandboxSkill("alpha", ["install", "--help"]);
    expect(log.mock.calls.flat().join("\n")).toContain("nemoclaw <sandbox> skill install <path>");
  });

  it("rejects unknown subcommands and extra arguments", async () => {
    mockExit();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(installSandboxSkill("alpha", ["remove"])).rejects.toThrow("exit:1");
    await expect(installSandboxSkill("alpha", ["install", "somewhere", "--bad"])).rejects.toThrow("exit:1");
    expect(error.mock.calls.flat().join("\n")).toContain("Unknown skill subcommand: remove");
    expect(error.mock.calls.flat().join("\n")).toContain("Unknown argument(s) for skill install: --bad");
  });

  it("points plugin-shaped paths at plugin guidance", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openclaw.plugin.json"), "{}");
    mockExit();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(installSandboxSkill("alpha", ["install", dir])).rejects.toThrow("exit:1");

    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("No SKILL.md found");
    expect(output).toContain("OpenClaw plugin");
  });
});
