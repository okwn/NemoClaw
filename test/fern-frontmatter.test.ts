// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(repoRoot, "docs");
const skipFiles = new Set(["CONTRIBUTING.md", "index.md"]);
const requiredScalarFrontmatterKeys = ["title", "description", "description_agent"];

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function readFrontmatter(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`${path.relative(repoRoot, file)} must start with YAML frontmatter`);
  }
  return YAML.parse(match[1]) ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  expect(isRecord(value), message).toBe(true);
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function expectNonEmptyString(value: unknown, message: string) {
  expect(value, message).toEqual(expect.any(String));
  expect(String(value).trim().length, message).toBeGreaterThan(0);
}

describe("Fern frontmatter", () => {
  const convertedMarkdownFiles = listMarkdownFiles(docsRoot).filter((file) => {
    const relative = path.relative(docsRoot, file).replaceAll(path.sep, "/");
    return !skipFiles.has(relative);
  });

  it("finds converted Markdown sources", () => {
    expect(convertedMarkdownFiles.length).toBeGreaterThan(0);
  });

  for (const markdownFile of convertedMarkdownFiles) {
    const mdxFile = markdownFile.replace(/\.md$/, ".mdx");
    const relPath = path.relative(repoRoot, mdxFile);

    it(`includes agent-routing frontmatter for ${relPath}`, () => {
      expect(fs.existsSync(mdxFile), `${relPath} was not generated`).toBe(true);

      const sourceFrontmatter = readFrontmatter(markdownFile);
      const fernFrontmatter = readFrontmatter(mdxFile);
      for (const key of requiredScalarFrontmatterKeys) {
        expectNonEmptyString(fernFrontmatter[key], `${relPath} has invalid frontmatter.${key}`);
      }
      expect(fernFrontmatter.keywords, `${relPath} must preserve frontmatter.keywords`).toEqual(
        sourceFrontmatter.keywords,
      );

      const sourceContent = requireRecord(
        sourceFrontmatter.content,
        `${path.relative(repoRoot, markdownFile)} is missing frontmatter.content`,
      );
      const fernContent = requireRecord(
        fernFrontmatter.content,
        `${relPath} is missing frontmatter.content`,
      );
      expect(fernContent.type, `${relPath} must preserve frontmatter.content.type`).toBe(
        sourceContent.type,
      );

      const sourceSkillPriority = isRecord(sourceFrontmatter.skill)
        ? sourceFrontmatter.skill.priority
        : sourceFrontmatter.skill_priority;
      if (sourceSkillPriority !== undefined && sourceSkillPriority !== "") {
        const fernSkill = requireRecord(
          fernFrontmatter.skill,
          `${relPath} is missing frontmatter.skill`,
        );
        expect(fernSkill.priority, `${relPath} must preserve frontmatter.skill.priority`).toBe(
          sourceSkillPriority,
        );
      }
    });
  }
});
