// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CHECK_BIN = path.join(REPO_ROOT, "scripts/e2e/check-parity-map.ts");

function makeRepo(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-parity-map-"));
  fs.mkdirSync(path.join(tmp, "test/e2e/docs"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "test/e2e/docs/parity-inventory.generated.json"),
    JSON.stringify(
      {
        generated_by: "test",
        entrypoints: [
          {
            script: "test/e2e/test-new.sh",
            assertions: [
              { script: "test/e2e/test-new.sh", line: 1, text: "CLI ready", polarity: "pass", normalized_id: "cli.ready", mapping_status: "unmapped" },
              { script: "test/e2e/test-new.sh", line: 2, text: "GPU ready", polarity: "pass", normalized_id: "gpu.ready", mapping_status: "unmapped" },
              { script: "test/e2e/test-new.sh", line: 3, text: "Old behavior", polarity: "fail", normalized_id: "old.behavior", mapping_status: "unmapped" },
            ],
          },
        ],
        totals: { scripts: 1, assertions: 3, zero_assertion_scripts: 0 },
      },
      null,
      2,
    ),
  );
  return tmp;
}

function writeMap(root: string, yaml: string) {
  fs.writeFileSync(path.join(root, "test/e2e/docs/parity-map.yaml"), yaml.trimStart());
}

function runCheck(root: string, args: string[] = []) {
  return spawnSync(path.join(REPO_ROOT, "node_modules/.bin/tsx"), [CHECK_BIN, "--root", root, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: Number(process.env.E2E_SPAWN_TIMEOUT_MS ?? 60_000),
  });
}

const SCOPED_LIFECYCLE_SCRIPTS = [
  "test-issue-2478-crash-loop-recovery.sh",
  "test-sandbox-operations.sh",
  "test-sandbox-survival.sh",
  "test-snapshot-commands.sh",
];

function loadRealParityMap(): string {
  return fs.readFileSync(path.join(REPO_ROOT, "test/e2e/docs/parity-map.yaml"), "utf8");
}

function extractScriptBlock(yaml: string, script: string): string {
  const marker = `  ${script}:`;
  const start = yaml.indexOf(marker);
  expect(start, `${script} missing from parity map`).toBeGreaterThanOrEqual(0);
  const rest = yaml.slice(start + marker.length);
  const next = rest.search(/\n  [^\s][^\n]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("sandbox lifecycle parity classification", () => {
  it("test_should_classify_all_scoped_sandbox_lifecycle_assertions", () => {
    const yaml = loadRealParityMap();
    for (const script of SCOPED_LIFECYCLE_SCRIPTS) {
      const block = extractScriptBlock(yaml, script);
      expect(block).toMatch(/bucket:\s*lifecycle/);
      expect(block).not.toMatch(/status:\s*uncategorized|mapping_status:\s*unmapped/);
      for (const entry of block.split(/\n    - legacy:/).slice(1)) {
        if (/status:\s*mapped/.test(entry)) {
          expect(entry, `${script} mapped entry missing id`).toMatch(/\n      id:\s*validation\.sandbox_(lifecycle|operations|snapshot)\./);
          expect(entry).toMatch(/\n      layer:\s*validation/);
          expect(entry).toMatch(/\n      gap_domain:\s*sandbox-lifecycle/);
          expect(entry).toMatch(/\n      owner:\s*e2e-maintainers/);
        } else if (/status:\s*deferred/.test(entry)) {
          expect(entry).toMatch(/\n      reason:\s*.+/);
          expect(entry).toMatch(/\n      owner:\s*e2e-maintainers/);
          expect(entry).toMatch(/\n      (runner_requirement|secret_requirement):\s*.+/);
        } else if (/status:\s*retired/.test(entry)) {
          expect(entry).toMatch(/\n      reason:\s*.+/);
          expect(entry).toMatch(/\n      reviewer:\s*e2e-maintainers/);
          expect(entry).toMatch(/\n      approved_at:\s*["']?2026-05-20["']?/);
        } else {
          throw new Error(`${script} has uncategorized parity entry: ${entry}`);
        }
      }
    }
  });

  it("test_should_use_validation_namespace_for_mapped_lifecycle_assertions", () => {
    const yaml = loadRealParityMap();
    const mappedIds = SCOPED_LIFECYCLE_SCRIPTS.flatMap((script) => {
      const block = extractScriptBlock(yaml, script);
      return Array.from(block.matchAll(/status:\s*mapped[\s\S]*?\n      id:\s*([^\n]+)/g)).map((m) => m[1].trim());
    });
    expect(mappedIds.length).toBeGreaterThan(0);
    expect(mappedIds).toContain("validation.sandbox_lifecycle.gateway_health");
    expect(mappedIds).toContain("validation.sandbox_operations.status_fields_present");
    expect(mappedIds).toContain("validation.sandbox_snapshot.create_succeeds");
    for (const id of mappedIds) {
      expect(id).toMatch(/^validation\.sandbox_(lifecycle|operations|snapshot)\./);
    }
  });
});

describe("parity map schema validation", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeRepo();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("check_parity_map_should_pass_non_strict_with_seeded_empty_entries", () => {
    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    scenario: ""
    assertions: []
`,
    );
    const r = runCheck(tmp);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("check_parity_map_should_fail_when_script_entry_missing", () => {
    writeMap(tmp, "scripts: {}\n");
    const r = runCheck(tmp);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/test-new\.sh/);
  });

  it("check_parity_map_should_validate_status_required_fields", () => {
    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    status: migrated
    scenario: ubuntu-repo-cloud-openclaw
    assertions:
      - legacy: "CLI ready"
        status: mapped
      - legacy: "GPU ready"
        status: deferred
        reason: requires-gpu-runner
        owner: e2e
      - legacy: "Old behavior"
        status: retired
        reason: obsolete
        reviewer: e2e
`,
    );
    const r = runCheck(tmp);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/id/);
    expect(r.stdout + r.stderr).toMatch(/runner_requirement|secret_requirement/);
    expect(r.stdout + r.stderr).toMatch(/approved_at/);
  });

  it("check_parity_map_strict_should_fail_on_empty_or_uncategorized_assertions", () => {
    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    scenario: ""
    assertions: []
`,
    );
    const empty = runCheck(tmp, ["--strict"]);
    expect(empty.status).not.toBe(0);
    expect(empty.stdout + empty.stderr).toMatch(/strict|empty|uncategorized/i);

    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    scenario: ubuntu-repo-cloud-openclaw
    assertions:
      - legacy: "CLI ready"
        id: smoke.cli.available
`,
    );
    const missingStatus = runCheck(tmp, ["--strict"]);
    expect(missingStatus.status).not.toBe(0);
    expect(missingStatus.stdout + missingStatus.stderr).toMatch(/status/);
  });

  it("check_parity_map_should_reject_unknown_legacy_assertion_strings", () => {
    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    scenario: ubuntu-repo-cloud-openclaw
    assertions:
      - legacy: "CLI redy"
        id: smoke.cli.available
        status: mapped
`,
    );
    const r = runCheck(tmp);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/CLI redy/);
    expect(r.stdout + r.stderr).toMatch(/unknown|inventory/i);
  });

  it("check_parity_map_should_reject_duplicate_ids_unless_reusable", () => {
    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    scenario: ubuntu-repo-cloud-openclaw
    assertions:
      - legacy: "CLI ready"
        id: smoke.cli.available
        status: mapped
      - legacy: "GPU ready"
        id: smoke.cli.available
        status: mapped
`,
    );
    const duplicate = runCheck(tmp);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stdout + duplicate.stderr).toMatch(/duplicate|smoke\.cli\.available/);

    writeMap(
      tmp,
      `
scripts:
  test-new.sh:
    scenario: ubuntu-repo-cloud-openclaw
    assertions:
      - legacy: "CLI ready"
        id: smoke.cli.available
        status: mapped
        reusable: true
      - legacy: "GPU ready"
        id: smoke.cli.available
        status: mapped
        reusable: true
      - legacy: "Old behavior"
        status: retired
        reason: obsolete
        reviewer: e2e
        approved_at: "2026-05-13"
`,
    );
    const reusable = runCheck(tmp);
    expect(reusable.status, reusable.stdout + reusable.stderr).toBe(0);
  });
});
