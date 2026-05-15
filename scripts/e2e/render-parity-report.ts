#!/usr/bin/env tsx
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/** Render a human-readable E2E parity and coverage report for GitHub Actions. */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

interface ParityAssertion {
  legacy?: string;
  status?: "mapped" | "deferred" | "retired";
  id?: string;
}

interface ParityScript {
  scenario?: string;
  status?: string;
  bucket?: string;
  assertions?: ParityAssertion[];
}

interface ParityMap {
  scripts?: Record<string, ParityScript>;
}

interface SetupScenario {
  dimensions?: {
    platform?: string;
    install?: string;
    runtime?: string;
    onboarding?: string;
  };
  expected_state?: string;
  suites?: string[];
  runner_requirements?: string[];
}

interface ScenariosYaml {
  platforms?: Record<string, Record<string, unknown>>;
  installs?: Record<string, Record<string, unknown>>;
  runtimes?: Record<string, Record<string, unknown>>;
  onboarding?: Record<string, Record<string, unknown>>;
  setup_scenarios?: Record<string, SetupScenario>;
}

interface ParityReportJson {
  script?: string;
  scenario?: string;
  bucket?: string;
  counts?: Record<string, number>;
  divergence?: unknown[];
  outcomes?: unknown[];
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const opts = {
    root: process.cwd(),
    parityJson: "",
    output: "",
    coverageReport: "",
  };
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--root") opts.root = path.resolve(args.shift() ?? "");
    else if (arg === "--parity-json") opts.parityJson = path.resolve(args.shift() ?? "");
    else if (arg === "--output") opts.output = path.resolve(args.shift() ?? "");
    else if (arg === "--coverage-report") opts.coverageReport = path.resolve(args.shift() ?? "");
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write("tsx scripts/e2e/render-parity-report.ts [--root <repo>] [--parity-json <file>] [--coverage-report <file>] [--output <file>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`render-parity-report: unexpected arg: ${arg}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function readYaml<T>(file: string): T {
  return yaml.load(fs.readFileSync(file, "utf8")) as T;
}

function readJson<T>(file: string): T | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function countAssertions(parity: ParityMap) {
  const totals = { mapped: 0, notConverted: 0, retired: 0, total: 0 };
  const byScript: Array<{ script: string; bucket: string; mapped: number; notConverted: number; retired: number; total: number }> = [];

  for (const [script, entry] of Object.entries(parity.scripts ?? {})) {
    const row = { script, bucket: String(entry.bucket ?? ""), mapped: 0, notConverted: 0, retired: 0, total: 0 };
    for (const assertion of entry.assertions ?? []) {
      row.total++;
      totals.total++;
      if (assertion.status === "retired") {
        row.retired++;
        totals.retired++;
      } else if (assertion.status === "deferred") {
        row.notConverted++;
        totals.notConverted++;
      } else {
        row.mapped++;
        totals.mapped++;
      }
    }
    if (row.total > 0) byScript.push(row);
  }
  byScript.sort((a, b) => b.notConverted - a.notConverted || a.script.localeCompare(b.script));
  return { totals, byScript };
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function scenarioRows(scenarios: ScenariosYaml) {
  const rows = [];
  for (const [id, scenario] of Object.entries(scenarios.setup_scenarios ?? {})) {
    const platformId = scenario.dimensions?.platform ?? "";
    const installId = scenario.dimensions?.install ?? "";
    const runtimeId = scenario.dimensions?.runtime ?? "";
    const onboardingId = scenario.dimensions?.onboarding ?? "";
    const platform = scenarios.platforms?.[platformId] ?? {};
    const install = scenarios.installs?.[installId] ?? {};
    const runtime = scenarios.runtimes?.[runtimeId] ?? {};
    const onboarding = scenarios.onboarding?.[onboardingId] ?? {};
    const fullOnboardBlocked = platformId === "macos-local"
      ? "Blocked: hosted macOS runner currently lacks Docker for full onboarding."
      : runtimeId === "docker-missing"
        ? "Negative preflight: full onboarding intentionally must not run."
        : "Expected to run full onboarding when runner/secrets are available.";
    rows.push({
      id,
      base: `${formatValue(platform.os)} / ${formatValue(platform.execution_target)}`,
      install: `${installId} (${formatValue(install.method)})`,
      runtime: `${runtimeId} (${formatValue(runtime.container_daemon)})`,
      onboarding: `${onboardingId} (${formatValue(onboarding.provider)} ${formatValue(onboarding.agent)})`,
      suites: (scenario.suites ?? []).join(", ") || "—",
      note: fullOnboardBlocked,
    });
  }
  return rows;
}

function mdTable(headers: string[], rows: string[][]): string {
  const escape = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => escape(cell)).join(" | ")} |`),
  ].join("\n");
}

function main() {
  const opts = parseArgs(process.argv);
  const parityMap = readYaml<ParityMap>(path.join(opts.root, "test/e2e/docs/parity-map.yaml"));
  const scenarios = readYaml<ScenariosYaml>(path.join(opts.root, "test/e2e/nemoclaw_scenarios/scenarios.yaml"));
  const liveParity = readJson<ParityReportJson>(opts.parityJson);
  const { totals, byScript } = countAssertions(parityMap);
  const topUnconverted = byScript.filter((row) => row.notConverted > 0).slice(0, 12);
  const coverage = opts.coverageReport && fs.existsSync(opts.coverageReport)
    ? fs.readFileSync(opts.coverageReport, "utf8").trim()
    : "";

  const lines: string[] = [];
  lines.push("# E2E parity and coverage report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("This report summarizes legacy E2E assertion conversion, scenario coverage, and current parity comparison output. It is intended to make coverage gaps visible while the scenario runner is being restructured into base environment scenarios, onboarding overlays, and post-onboard feature suites.");
  lines.push("");
  lines.push(mdTable(["Metric", "Count"], [
    ["Mapped assertions", String(totals.mapped)],
    ["Assertions not yet converted", String(totals.notConverted)],
    ["Retired assertions", String(totals.retired)],
    ["Total tracked legacy assertions", String(totals.total)],
  ]));
  lines.push("");
  lines.push("> “Assertions not yet converted” are legacy E2E PASS/FAIL assertions that are tracked in the parity map but are not yet represented by a mapped assertion in the scenario framework. They are not necessarily one test each: some will be consolidated, some require runner or secret support, some belong in onboarding-stage checks, and some may be retired.");
  lines.push("");

  if (liveParity) {
    lines.push("## Current parity comparison");
    lines.push("");
    lines.push(mdTable(["Field", "Value"], [
      ["Legacy script", formatValue(liveParity.script)],
      ["Scenario", formatValue(liveParity.scenario)],
      ["Bucket", formatValue(liveParity.bucket)],
      ["Divergences", String(liveParity.divergence?.length ?? 0)],
      ["Mapped assertions compared", String(liveParity.counts?.mapped ?? 0)],
      ["Assertions not yet converted in this comparison", String(liveParity.counts?.deferred ?? 0)],
      ["Retired assertions in this comparison", String(liveParity.counts?.retired ?? 0)],
    ]));
    lines.push("");
  }

  lines.push("## Scenario coverage and platform notes");
  lines.push("");
  lines.push(mdTable(
    ["Scenario", "Base", "Install", "Runtime", "Onboarding", "Suites", "Full onboarding note"],
    scenarioRows(scenarios).map((row) => [row.id, row.base, row.install, row.runtime, row.onboarding, row.suites, row.note]),
  ));
  lines.push("");
  lines.push("Platform gap to call out: the macOS scenario is currently not expected to complete full Docker-backed onboarding on hosted macOS because Docker is not available there. Other non-negative scenarios are intended to run full onboarding when their runner and secret requirements are satisfied.");
  lines.push("");

  lines.push("## Largest assertion conversion gaps");
  lines.push("");
  lines.push(mdTable(
    ["Legacy entrypoint", "Mapped", "Assertions not yet converted", "Retired"],
    topUnconverted.map((row) => [row.script, String(row.mapped), String(row.notConverted), String(row.retired)]),
  ));
  lines.push("");

  lines.push("## Coverage interpretation");
  lines.push("");
  lines.push("The scenario framework increases visibility by separating setup dimensions, expected-state contracts, and post-onboard suites. The next coverage improvement is to classify unconverted assertions by destination: base environment setup, onboarding flow, expected-state validation, post-onboard feature suite, negative/failure mode, or retire candidate.");
  lines.push("");
  lines.push("Priority areas suggested by the current parity map are onboarding lifecycle, messaging providers, security/shields, sandbox lifecycle, GPU/Ollama, credential sanitization, and inference routing.");

  if (coverage) {
    lines.push("");
    lines.push("## Scenario × suite coverage matrix");
    lines.push("");
    lines.push(coverage
    .replace(/Deferred assertions/g, "Assertions not yet converted")
    .replace(/\| Bucket \| Scripts \| Mapped \| Deferred \| Retired \| Unmapped \|/g, "| Bucket | Scripts | Mapped | Assertions not yet converted | Retired | Unmapped |"));
  }

  const report = `${lines.join("\n")}\n`;
  if (opts.output) {
    fs.mkdirSync(path.dirname(opts.output), { recursive: true });
    fs.writeFileSync(opts.output, report);
  }
  process.stdout.write(report);
}

main();
