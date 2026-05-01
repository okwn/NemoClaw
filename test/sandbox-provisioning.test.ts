// @ts-nocheck
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Regression guards for sandbox image provisioning.
//
// Verifies that the image-build sources (Dockerfile and Dockerfile.base)
// preserve the mutable-by-default config layout (#2227) and the gateway
// auth token externalization (#2378).
//
// These are static regression guards over the Dockerfile text — they fail
// immediately if a future refactor drops one of the baked-in provisioning
// steps, even before a full image build runs in CI.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOCKERFILE = path.join(ROOT, "Dockerfile");
const DOCKERFILE_BASE = path.join(ROOT, "Dockerfile.base");
const DOCKERFILE_SANDBOX = path.join(ROOT, "test", "Dockerfile.sandbox");


function dockerRunCommandBetween(dockerfile: string, startMarker: string, endMarker: string): string {
  const start = dockerfile.indexOf(startMarker);
  const end = dockerfile.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected Dockerfile block between ${startMarker} and ${endMarker}`);
  }
  const runIndex = dockerfile.indexOf("RUN ", start);
  if (runIndex === -1 || runIndex > end) {
    throw new Error(`Expected RUN instruction after ${startMarker}`);
  }
  return dockerfile
    .slice(runIndex, end)
    .trim()
    .replace(/^RUN\s+/, "")
    .replace(/\\\n/g, " ");
}

function runDockerShell(command: string, sandboxRoot: string) {
  const logPath = path.join(sandboxRoot, "calls.log");
  fs.rmSync(logPath, { force: true });
  const rewritten = command.replaceAll("/sandbox", sandboxRoot);
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `call_log=${JSON.stringify(logPath)}`,
    'chown() { printf "chown %s\\n" "$*" >> "$call_log"; }',
    rewritten,
  ].join("\n");
  const scriptPath = path.join(sandboxRoot, "run-docker-block.sh");
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  const result = spawnSync("bash", [scriptPath], { encoding: "utf-8", timeout: 5000 });
  const calls = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8") : "";
  return { result, calls };
}

describe("sandbox provisioning: unified .openclaw layout (#2227)", () => {
  it("provisions unified mutable .openclaw layout and trusted rc shims", () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_BASE, "utf-8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-base-layout-"));
    const sandboxRoot = path.join(tmp, "sandbox");
    fs.mkdirSync(sandboxRoot, { recursive: true });

    try {
      const layout = runDockerShell(
        dockerRunCommandBetween(
          dockerfile,
          "# Create .openclaw with all state subdirs directly",
          "# Pre-create shell init files",
        ),
        sandboxRoot,
      );
      expect(layout.result.status).toBe(0);
      const openclawDir = path.join(sandboxRoot, ".openclaw");
      expect(fs.statSync(openclawDir).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(openclawDir, "exec-approvals.json")).isFile()).toBe(true);
      expect(fs.statSync(path.join(openclawDir, "update-check.json")).isFile()).toBe(true);
      expect(fs.existsSync(path.join(sandboxRoot, ".openclaw-data"))).toBe(false);
      expect(fs.lstatSync(path.join(openclawDir, "exec-approvals.json")).isSymbolicLink()).toBe(
        false,
      );
      expect(layout.calls).toContain(`chown -R sandbox:sandbox ${openclawDir}`);

      const rc = runDockerShell(
        dockerRunCommandBetween(
          dockerfile,
          "# Pre-create shell init files for the sandbox user.",
          "# Install OpenClaw CLI + PyYAML",
        ),
        sandboxRoot,
      );
      expect(rc.result.status).toBe(0);
      const runtimeEnvShim = "[ -f /tmp/nemoclaw-proxy-env.sh ] && . /tmp/nemoclaw-proxy-env.sh";
      for (const rcName of [".bashrc", ".profile"]) {
        const rcPath = path.join(sandboxRoot, rcName);
        const content = fs.readFileSync(rcPath, "utf-8");
        expect(content.split(runtimeEnvShim).length - 1).toBe(1);
        expect((fs.statSync(rcPath).mode & 0o777).toString(8)).toBe("444");
      }
      expect(rc.calls).toContain(`chown root:root ${path.join(sandboxRoot, ".bashrc")} ${path.join(sandboxRoot, ".profile")}`);
      expect(rc.calls).not.toContain("sandbox:sandbox");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("sandbox provisioning: procps debug tools (#2343)", () => {
  it("runtime hardening installs procps when a stale base lacks ps", () => {
    const dockerfile = fs.readFileSync(DOCKERFILE, "utf-8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-procps-"));
    const log = path.join(tmp, "calls.log");
    const marker = path.join(tmp, "ps-installed");
    const lists = path.join(tmp, "apt-lists");
    fs.mkdirSync(lists);
    const command = dockerRunCommandBetween(
      dockerfile,
      "# Harden: remove unnecessary build tools",
      "# Copy built plugin and blueprint",
    ).replaceAll("/var/lib/apt/lists", lists);
    const script = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `call_log=${JSON.stringify(log)}`,
      `ps_marker=${JSON.stringify(marker)}`,
      'apt-mark() { printf "apt-mark %s\\n" "$*" >> "$call_log"; }',
      'apt-get() { printf "apt-get %s\\n" "$*" >> "$call_log"; if [[ "$*" == *"install"* && "$*" == *"procps=2:4.0.2-3"* ]]; then touch "$ps_marker"; fi; }',
      'command() { if [ "${1:-}" = "-v" ] && [ "${2:-}" = "ps" ]; then [ -f "$ps_marker" ]; else builtin command "$@"; fi; }',
      'ps() { [ -f "$ps_marker" ] || return 127; printf "procps test version\\n"; }',
      command,
    ].join("\n");
    const scriptPath = path.join(tmp, "run.sh");
    try {
      fs.writeFileSync(scriptPath, script, { mode: 0o700 });
      const result = spawnSync("bash", [scriptPath], { encoding: "utf-8", timeout: 5000 });
      expect(result.status).toBe(0);
      const calls = fs.readFileSync(log, "utf-8");
      expect(calls).toContain("apt-mark manual procps");
      expect(calls).toContain("apt-get autoremove --purge -y");
      expect(calls).toContain("apt-get update");
      expect(calls).toContain("apt-get install -y --no-install-recommends procps=2:4.0.2-3");
      expect(result.stdout).toContain("procps test version");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("sandbox provisioning: gateway auth token externalization (#2378)", () => {
  it("runtime image clears generated gateway auth tokens from openclaw.json", () => {
    const dockerfile = fs.readFileSync(DOCKERFILE, "utf-8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-clear-token-"));
    const openclawDir = path.join(tmp, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    const configPath = path.join(openclawDir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ gateway: { auth: { token: "generated-secret" } } }),
      { mode: 0o644 },
    );
    const command = dockerRunCommandBetween(
      dockerfile,
      "# SECURITY: Clear any gateway auth token",
      "# Flatten stale published base images",
    ).replace('python3 -c " ', 'python3 -c "');
    const scriptPath = path.join(tmp, "run.sh");
    try {
      fs.writeFileSync(scriptPath, ["#!/usr/bin/env bash", "set -euo pipefail", command].join("\n"), {
        mode: 0o700,
      });
      const result = spawnSync("bash", [scriptPath], {
        encoding: "utf-8",
        env: { ...process.env, HOME: tmp },
        timeout: 5000,
      });
      expect(result.status).toBe(0);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.gateway.auth.token).toBe("");
      expect((fs.statSync(configPath).mode & 0o777).toString(8)).toBe("600");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("sandbox provisioning: codex-acp wrapper (#2484)", () => {
  it("runs codex-acp with writable Codex and XDG state", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-codex-wrapper-"));
    const log = path.join(tmp, "exec.log");
    const sourceScript = `
exec() {
  printf 'argv=%s\n' "$*" > ${JSON.stringify(log)}
  printf 'HOME=%s\n' "$HOME" >> ${JSON.stringify(log)}
  printf 'CODEX_HOME=%s\n' "$CODEX_HOME" >> ${JSON.stringify(log)}
  printf 'XDG_CONFIG_HOME=%s\n' "$XDG_CONFIG_HOME" >> ${JSON.stringify(log)}
  return 0
}
source ${JSON.stringify(path.join(ROOT, "scripts", "codex-acp-wrapper.sh"))} --stdio
`;
    try {
      const result = spawnSync("bash", ["-c", sourceScript], {
        encoding: "utf-8",
        env: { ...process.env, NEMOCLAW_CODEX_ACP_HOME: tmp },
      });
      expect(result.status).toBe(0);
      const output = fs.readFileSync(log, "utf-8");
      expect(output).toContain("argv=/usr/local/bin/codex-acp --stdio");
      for (const dir of ["home", "codex", "sqlite", "cache", "config", "data", "state", "runtime", "gnupg"]) {
        expect(fs.statSync(path.join(tmp, dir)).isDirectory()).toBe(true);
      }
      expect((fs.statSync(path.join(tmp, "gitconfig")).mode & 0o777).toString(8)).toBe("600");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("sandbox test image fixtures", () => {
  const src = fs.readFileSync(DOCKERFILE_SANDBOX, "utf-8");

  it("clears production config recovery artifacts after writing the legacy fixture", () => {
    expect(src).toContain("/sandbox/.openclaw/openclaw.json.bak*");
    expect(src).toContain("/sandbox/.openclaw/openclaw.json.last-good");
    expect(src).toContain("/sandbox/.openclaw-data/logs/config-health.json");
  });
});

describe("sandbox operations E2E harness", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "test", "e2e", "test-sandbox-operations.sh"),
    "utf-8",
  );

  it("resumes onboard when OpenShell resets after importing the image", () => {
    expect(src).toContain("is_onboard_import_stream_reset");
    expect(src).toContain("Connection reset by peer (os error 104)");
    expect(src).toContain("nemoclaw onboard --resume --non-interactive");
  });
});
