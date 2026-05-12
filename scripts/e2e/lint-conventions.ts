#!/usr/bin/env tsx
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * E2E convention lint.
 *
 * Enforces the migration-spec conventions on
 * `test/e2e/validation_suites/**` step scripts and the
 * `test/e2e/test-*.sh` legacy frontier:
 *
 *   - Suite step scripts MUST NOT re-export non-interactive env vars
 *     (use lib/env.sh::e2e_env_apply_noninteractive instead).
 *   - Suite step scripts MUST NOT register their own traps
 *     (lib/cleanup.sh owns teardown).
 *   - Suite step scripts MUST NOT call `section "..."` — filenames carry
 *     the phase label, and e2e_section is emitted by the runner.
 *   - Suite step scripts MUST NOT write to `/tmp/*.log` — use
 *     `$E2E_CONTEXT_DIR/logs/<scenario>/<suite>/<step>.log`.
 *   - Non-standard repo-root discovery (`git rev-parse --show-toplevel`)
 *     is rejected in suite step scripts; use
 *     `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` and
 *     walk up.
 *   - Every `test/e2e/test-*.sh` script MUST have an entry in
 *     `test/e2e/docs/parity-map.yaml` (Risk #1: guards against new
 *     legacy scripts landing unmapped).
 *
 * Invocation:
 *   tsx scripts/e2e/lint-conventions.ts [--root <repo-root>]
 * Exits 0 on success, 1 on violations, 2 on misuse.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Rule {
  id: string;
  describe: string;
  test: (body: string) => string | null;
}

const STEP_RULES: Rule[] = [
  {
    id: "no-noninteractive-reexport",
    describe: "suite step re-exports non-interactive env vars",
    test: (body) => {
      const patterns = [
        /export\s+DEBIAN_FRONTEND\s*=\s*noninteractive/,
        /export\s+NEMOCLAW_NON_INTERACTIVE\s*=\s*1/,
      ];
      for (const p of patterns) {
        if (p.test(body))
          return `matched ${p.source}; use lib/env.sh::e2e_env_apply_noninteractive`;
      }
      return null;
    },
  },
  {
    id: "no-own-trap",
    describe: "suite step registers its own trap",
    test: (body) => {
      // Ignore commented lines and ignore `trap` inside quoted strings by
      // requiring a leading non-quote character.
      const lines = body.split("\n");
      for (const raw of lines) {
        const line = raw.replace(/^\s+/, "");
        if (line.startsWith("#")) continue;
        if (/^trap\s+[^#]/.test(line)) {
          return "registered own trap; cleanup lives in lib/cleanup.sh";
        }
      }
      return null;
    },
  },
  {
    id: "no-section-call",
    describe: "suite step calls section/e2e_section",
    test: (body) => {
      const lines = body.split("\n");
      for (const raw of lines) {
        const line = raw.replace(/^\s+/, "");
        if (line.startsWith("#")) continue;
        if (/^section\s+["']/.test(line)) {
          return "calls section; filename carries the phase label";
        }
      }
      return null;
    },
  },
  {
    id: "no-tmp-log",
    describe: "suite step writes to /tmp/*.log",
    test: (body) => {
      if (/>\s*\/tmp\/[^\s]*\.log/.test(body)) {
        return "writes to /tmp/*.log; use $E2E_CONTEXT_DIR/logs/<scenario>/<suite>/<step>.log";
      }
      return null;
    },
  },
  {
    id: "no-git-rev-parse-repo-root",
    describe: "suite step uses `git rev-parse --show-toplevel` for repo root",
    test: (body) => {
      if (/git\s+rev-parse\s+--show-toplevel/.test(body)) {
        return 'use SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" instead';
      }
      return null;
    },
  },
];

interface LintFinding {
  file: string;
  rule: string;
  message: string;
}

function walkShellScripts(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(".sh")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function parseArgs(argv: string[]): { root: string } {
  let root: string | undefined;
  const args = argv.slice(2);
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === "--root") root = args.shift();
    else if (a === "-h" || a === "--help") {
      process.stdout.write("tsx scripts/e2e/lint-conventions.ts [--root <repo-root>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`lint-conventions: unexpected arg: ${a}\n`);
      process.exit(2);
    }
  }
  if (!root) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    root = path.resolve(scriptDir, "..", "..");
  }
  return { root };
}

function lintSuiteSteps(root: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const suitesRoot = path.join(root, "test/e2e/validation_suites");
  if (!fs.existsSync(suitesRoot)) return findings;
  for (const file of walkShellScripts(suitesRoot)) {
    const body = fs.readFileSync(file, "utf8");
    for (const rule of STEP_RULES) {
      const msg = rule.test(body);
      if (msg) {
        findings.push({ file: path.relative(root, file), rule: rule.id, message: msg });
      }
    }
  }
  return findings;
}

/**
 * Read `test/e2e/parity-map.yaml` and return the set of legacy-script
 * names that have an entry. Uses a narrow parser to avoid a runtime
 * dependency when js-yaml is not available.
 */
function readParityMapScripts(mapFile: string): Set<string> {
  const set = new Set<string>();
  if (!fs.existsSync(mapFile)) return set;
  const text = fs.readFileSync(mapFile, "utf8");
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s{2}([\w.\-]+):\s*$/);
    if (m) set.add(m[1]);
  }
  return set;
}

function lintLegacyFrontier(root: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const e2eDir = path.join(root, "test/e2e");
  const mapFile = path.join(e2eDir, "docs", "parity-map.yaml");
  const mapped = readParityMapScripts(mapFile);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(e2eDir, { withFileTypes: true });
  } catch {
    return findings;
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!/^test-.*\.sh$/.test(ent.name)) continue;
    if (mapped.has(ent.name)) continue;
    findings.push({
      file: `test/e2e/${ent.name}`,
      rule: "legacy-script-needs-parity-map-entry",
      message: `new legacy test/e2e/${ent.name} has no entry in test/e2e/docs/parity-map.yaml (Risk #1)`,
    });
  }
  return findings;
}

function main(): number {
  const { root } = parseArgs(process.argv);
  const findings = [...lintSuiteSteps(root), ...lintLegacyFrontier(root)];
  if (findings.length === 0) {
    return 0;
  }
  for (const f of findings) {
    process.stderr.write(`${f.file}: [${f.rule}] ${f.message}\n`);
  }
  process.stderr.write(`\ne2e-convention-lint: ${findings.length} violation(s)\n`);
  return 1;
}

process.exit(main());
