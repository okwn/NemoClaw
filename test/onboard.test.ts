// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../dist/lib/agent/defs.js";
import { loadAgent } from "../dist/lib/agent/defs.js";
import { applyOnboardVmDnsMonkeypatch } from "../dist/lib/onboard/vm-dns-monkeypatch.js";
import { stageOptimizedSandboxBuildContext } from "../dist/lib/sandbox/build-context.js";
import { testTimeoutOptions } from "./helpers/timeouts";

type ShimScalar = string | number | boolean | null | undefined;
type ShimCallable = (...args: readonly string[]) => ShimValue;
type ShimValue = ShimScalar | { [key: string]: ShimValue } | ShimValue[] | ShimCallable;
type ShimFn<TReturn = void> = (...args: ShimValue[]) => TReturn;
type CommandEntry = {
  command: string;
  env?: Record<string, string | undefined>;
  policyContent?: string;
  policyReadError?: string;
  dockerfileContent?: string;
  dockerfileReadError?: string;
};
type DashboardAccess = { label: string; url: string };
type ResumeConflict = { field: string; requested: string | null; recorded: string | null };

type OnboardTestInternals = {
  buildSandboxConfigSyncScript: ShimFn<string>;
  classifySandboxCreateFailure: (output?: string) => { kind: string; uploadedToGateway: boolean };
  compactText: (value?: string) => string;
  formatEnvAssignment: (name: string, value: string) => string;
  findAvailableDashboardPort: (
    sandboxName: string,
    preferredPort: number,
    forwardListOutput: string | null,
    isPortBoundCheck?: (port: number) => boolean,
  ) => number;
  findDashboardForwardOwner: (
    forwardListOutput: string | null | undefined,
    portToStop: string,
  ) => string | null;
  formatOnboardConfigSummary: ShimFn<string>;
  formatSandboxBuildEstimateNote: (host: {
    isContainerRuntimeUnderProvisioned: boolean;
    dockerCpus?: number;
    dockerMemTotalBytes?: number;
  }) => string | null;
  getDashboardAccessInfo: ShimFn<DashboardAccess[]>;
  getDashboardForwardStartCommand: ShimFn<string>;
  getNavigationChoice: (value?: string | null) => string | null;
  getGatewayReuseState: ShimFn<string>;
  getFutureShellPathHint: (binDir: string, pathValue?: string) => string | null;
  resolveSandboxGpuConfig: (
    gpu: { type: string } | null,
    options?: { flag?: "enable" | "disable" | null; device?: string | null; env?: NodeJS.ProcessEnv },
  ) => {
    mode: "auto" | "1" | "0";
    hostGpuDetected: boolean;
    sandboxGpuEnabled: boolean;
    sandboxGpuDevice: string | null;
    errors: string[];
  };
  getResumeSandboxGpuOverrides: (
    entry:
      | { sandboxGpuMode?: "auto" | "1" | "0" | string | null; sandboxGpuDevice?: string | null }
      | null
      | undefined,
    sessionGpuPassthrough?: boolean,
  ) => { flag: "enable" | "disable" | null; device: string | null };
  getRequestedModelHint: ShimFn<string | null>;
  getRequestedProviderHint: ShimFn<string | null>;
  getRequestedSandboxNameHint: ShimFn<string | null>;
  getResumeConfigConflicts: ShimFn<ResumeConflict[]>;
  getResumeSandboxConflict: ShimFn<{
    requestedSandboxName: string;
    recordedSandboxName: string;
  } | null>;
  getSandboxStateFromOutputs: ShimFn<string>;
  isGatewayHealthy: ShimFn<boolean>;
  agentSupportsWebSearch: (
    agent?: AgentDefinition | null,
    dockerfilePathOverride?: string | null,
  ) => boolean;
  configureWebSearch: (
    existingConfig?: ShimValue,
    agent?: AgentDefinition | null,
    dockerfilePathOverride?: string | null,
  ) => Promise<ShimValue>;
  parsePolicyPresetEnv: (value: string | null) => string[];
  pullAndResolveBaseImageDigest: () => { digest: string | null; ref: string } | null;
  SANDBOX_BASE_IMAGE: string;
  printSandboxCreateRecoveryHints: ShimFn<void>;
  resolveDashboardForwardTarget: (chatUiUrl?: string) => string;
  summarizeCurlFailure: ShimFn<string>;
  summarizeProbeFailure: ShimFn<string>;
  shouldIncludeBuildContextPath: ShimFn<boolean>;
  writeSandboxConfigSyncFile: (script: string) => string;
};

function parseStdoutJson<T>(stdout: string): T {
  const line = stdout.trim().split("\n").pop();
  assert.ok(line, `expected JSON payload in stdout:\n${stdout}`);
  return JSON.parse(line);
}

type OnboardTestInternalsCandidate = Partial<OnboardTestInternals> | null;

function isOnboardTestInternals(
  value: OnboardTestInternalsCandidate,
): value is OnboardTestInternals {
  return (
    value !== null &&
    typeof value.buildSandboxConfigSyncScript === "function" &&
    typeof value.classifySandboxCreateFailure === "function" &&
    typeof value.findAvailableDashboardPort === "function" &&
    typeof value.resolveSandboxGpuConfig === "function" &&
    typeof value.getResumeSandboxGpuOverrides === "function" &&
    typeof value.agentSupportsWebSearch === "function" &&
    typeof value.configureWebSearch === "function" &&
    typeof value.formatSandboxBuildEstimateNote === "function" &&
    typeof value.writeSandboxConfigSyncFile === "function"
  );
}

const loadedOnboardInternals = require("../dist/lib/onboard");
const onboardTestInternals =
  typeof loadedOnboardInternals === "object" && loadedOnboardInternals !== null
    ? loadedOnboardInternals
    : null;
if (!isOnboardTestInternals(onboardTestInternals)) {
  throw new Error("Expected onboard test internals to expose helper functions");
}

const {
  buildSandboxConfigSyncScript,
  classifySandboxCreateFailure,
  compactText,
  formatEnvAssignment,
  getNavigationChoice,
  getGatewayReuseState,
  getFutureShellPathHint,
  resolveSandboxGpuConfig,
  getResumeSandboxGpuOverrides,
  getRequestedModelHint,
  getRequestedProviderHint,
  getRequestedSandboxNameHint,
  getResumeConfigConflicts,
  getResumeSandboxConflict,
  getSandboxStateFromOutputs,
  isGatewayHealthy,
  agentSupportsWebSearch,
  configureWebSearch,
  parsePolicyPresetEnv,
  SANDBOX_BASE_IMAGE,
  printSandboxCreateRecoveryHints,
  summarizeCurlFailure,
  summarizeProbeFailure,
  shouldIncludeBuildContextPath,
  writeSandboxConfigSyncFile,
  findAvailableDashboardPort,
  findDashboardForwardOwner,
  formatOnboardConfigSummary,
  formatSandboxBuildEstimateNote,
} = onboardTestInternals;

const repoRoot = path.join(import.meta.dirname, "..");
const onboardScriptMocksPath = JSON.stringify(
  path.join(repoRoot, "test", "helpers", "onboard-script-mocks.cjs"),
);

describe("onboard helpers", () => {
  it("resolves sandbox GPU auto/force/disable modes", () => {
    const gpu = { type: "nvidia" };
    expect(resolveSandboxGpuConfig(gpu, { env: {} }).sandboxGpuEnabled).toBe(true);
    expect(
      resolveSandboxGpuConfig(gpu, {
        env: { NEMOCLAW_SANDBOX_GPU: "0" },
      }).sandboxGpuEnabled,
    ).toBe(false);
    const forced = resolveSandboxGpuConfig(null, {
      flag: "enable",
      env: {},
    });
    expect(forced.mode).toBe("1");
    expect(forced.errors.join("\n")).toContain("no NVIDIA GPU");
  });

  it("defaults to CPU sandbox on Jetson when NEMOCLAW_SANDBOX_GPU is unset", () => {
    const jetson = { type: "nvidia", platform: "jetson" as const };
    expect(resolveSandboxGpuConfig(jetson, { env: {} }).sandboxGpuEnabled).toBe(false);
    // Explicit env opt-in still wins over the platform default.
    expect(
      resolveSandboxGpuConfig(jetson, { env: { NEMOCLAW_SANDBOX_GPU: "1" } }).sandboxGpuEnabled,
    ).toBe(true);
    // --gpu also overrides the platform default.
    expect(resolveSandboxGpuConfig(jetson, { flag: "enable", env: {} }).mode).toBe("1");
  });

  it("resumes sandbox GPU auto mode without turning CPU fallback into explicit opt-out", () => {
    const resumedAuto = getResumeSandboxGpuOverrides(
      { sandboxGpuMode: "auto", sandboxGpuDevice: null },
      false,
    );
    expect(resumedAuto).toEqual({ flag: null, device: null });
    expect(
      resolveSandboxGpuConfig({ type: "nvidia" }, { ...resumedAuto, env: {} }).sandboxGpuEnabled,
    ).toBe(true);

    const resumedDisabled = getResumeSandboxGpuOverrides(
      { sandboxGpuMode: "0", sandboxGpuDevice: null },
      false,
    );
    expect(
      resolveSandboxGpuConfig({ type: "nvidia" }, { ...resumedDisabled, env: {} })
        .sandboxGpuEnabled,
    ).toBe(false);

    const legacyGpuSession = getResumeSandboxGpuOverrides(null, true);
    expect(legacyGpuSession.flag).toBe("enable");
  });

  it("classifies sandbox create timeout failures and tracks upload progress", () => {
    expect(
      classifySandboxCreateFailure("Error: failed to read image export stream\nTimeout error").kind,
    ).toBe("image_transfer_timeout");
    expect(
      classifySandboxCreateFailure(
        [
          '  Pushing image openshell/sandbox-from:123 into gateway "nemoclaw"',
          "  [progress] Uploaded to gateway",
          "Error: failed to read image export stream",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "image_transfer_timeout",
      uploadedToGateway: true,
    });
  });

  it("classifies sandbox create connection resets and incomplete create streams", () => {
    expect(classifySandboxCreateFailure("Connection reset by peer").kind).toBe(
      "image_transfer_reset",
    );
    expect(
      classifySandboxCreateFailure(
        [
          "  Image openshell/sandbox-from:123 is available in the gateway.",
          "Created sandbox: my-assistant",
          "Error: stream closed unexpectedly",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "sandbox_create_incomplete",
      uploadedToGateway: true,
    });
  });

  it("builds a sandbox sync script that does not rewrite OpenClaw config content", () => {
    const script = buildSandboxConfigSyncScript({
      endpointType: "custom",
      endpointUrl: "https://inference.local/v1",
      ncpPartner: null,
      model: "nemotron-3-nano:30b",
      profile: "inference-local",
      credentialEnv: "OPENAI_API_KEY",
      onboardedAt: "2026-03-18T12:00:00.000Z",
    });

    assert.match(script, /cat > ~\/\.nemoclaw\/config\.json/);
    assert.match(script, /"model": "nemotron-3-nano:30b"/);
    assert.match(script, /"credentialEnv": "OPENAI_API_KEY"/);
    assert.doesNotMatch(script, /cat > ~\/\.openclaw\/openclaw\.json/);
    assert.doesNotMatch(script, /openclaw models set/);
    assert.match(script, /config_dir=\/sandbox\/\.openclaw/);
    assert.match(script, /chmod -R g\+rwX,o-rwx "\$config_dir"/);
    assert.match(script, /find "\$config_dir" -type d -exec chmod g\+s \{\} \+/);
    assert.match(script, /chmod 2770 "\$config_dir"/);
    assert.match(script, /chmod 660 "\$config_dir\/openclaw\.json" "\$config_dir\/\.config-hash"/);
    assert.match(script, /\[ "\$config_dir_owner" != "root" \]/);
    assert.match(script, /^\s*exit$/m);
  });

  it("#2433: agentSupportsWebSearch detects whether agent Dockerfile declares the web search ARG", () => {
    // OpenClaw Dockerfile has ARG NEMOCLAW_WEB_SEARCH_ENABLED → supported.
    // Hermes Dockerfile does not → not supported.
    // null agent (default) → supported (assumes OpenClaw).
    expect(agentSupportsWebSearch(null)).toBe(true);
    expect(agentSupportsWebSearch(loadAgent("openclaw"))).toBe(true);
    expect(agentSupportsWebSearch(loadAgent("hermes"))).toBe(false);
  });

  it("#2433: agentSupportsWebSearch honors the effective custom Dockerfile for Brave-capable agents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-web-search-custom-"));
    const withoutArg = path.join(tmpDir, "Dockerfile.no-web");
    const withArg = path.join(tmpDir, "Dockerfile.web");
    const missing = path.join(tmpDir, "Dockerfile.missing");
    fs.writeFileSync(withoutArg, "FROM scratch\n");
    fs.writeFileSync(withArg, "FROM scratch\n  ARG NEMOCLAW_WEB_SEARCH_ENABLED=0\n");
    try {
      expect(agentSupportsWebSearch(loadAgent("openclaw"), withoutArg)).toBe(false);
      expect(agentSupportsWebSearch(loadAgent("hermes"), withArg)).toBe(false);
      expect(agentSupportsWebSearch(loadAgent("openclaw"), missing)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("#2433: configureWebSearch skips unsupported Hermes instead of prompting for Brave", async () => {
    const priorBraveKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "brv-test-key";
    try {
      await expect(configureWebSearch(null, loadAgent("hermes"))).resolves.toBeNull();
    } finally {
      if (priorBraveKey === undefined) {
        delete process.env.BRAVE_API_KEY;
      } else {
        process.env.BRAVE_API_KEY = priorBraveKey;
      }
    }
  });

  it("#2433: configureWebSearch does not call the prompt helper for unsupported Hermes", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-web-search-prompt-"));
    const scriptPath = path.join(tmpDir, "web-search-prompt-check.cjs");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));
    const agentDefsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "agent", "defs.js"));

    const script = `
let promptCalls = 0;
const actualCredentials = require(${credentialsPath});
const mockedCredentials = {
  ...actualCredentials,
  prompt: async () => {
  promptCalls += 1;
  throw new Error("prompt should not be called");
  },
};
require.cache[require.resolve(${credentialsPath})] = {
  id: require.resolve(${credentialsPath}),
  filename: require.resolve(${credentialsPath}),
  loaded: true,
  exports: mockedCredentials,
};
process.env.BRAVE_API_KEY = "brv-test-key";
const { configureWebSearch } = require(${onboardPath});
const { loadAgent } = require(${agentDefsPath});

(async () => {
  const result = await configureWebSearch(null, loadAgent("hermes"));
  console.log(JSON.stringify({ result, promptCalls }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);
    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: tmpDir,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const payload = parseStdoutJson<{ result: null; promptCalls: number }>(result.stdout);
      assert.equal(payload.result, null);
      assert.equal(payload.promptCalls, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("treats the gateway as healthy only when nemoclaw is running and connected", () => {
    expect(
      isGatewayHealthy(
        "Gateway status: Connected\nGateway: nemoclaw",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe(true);
    expect(
      isGatewayHealthy(
        "\u001b[1mServer Status\u001b[0m\n\n  Gateway: openshell\n  Server: https://127.0.0.1:8080\n  Status: Connected",
        "Error:   × No gateway metadata found for 'nemoclaw'.",
        "Gateway Info\n\n  Gateway: openshell\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe(false);
    expect(
      isGatewayHealthy(
        "Server Status\n\n  Gateway: openshell\n  Status: Connected",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
        "Gateway Info\n\n  Gateway: openshell\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe(false);
    expect(isGatewayHealthy("Gateway status: Disconnected", "Gateway: nemoclaw")).toBe(false);
    expect(isGatewayHealthy("Gateway status: Connected", "Gateway: something-else")).toBe(false);
  });

  it("classifies gateway reuse states conservatively", () => {
    expect(
      getGatewayReuseState(
        "Gateway status: Connected\nGateway: nemoclaw",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe("healthy");
    expect(
      getGatewayReuseState(
        "Gateway status: Connected",
        "Error:   × No gateway metadata found for 'nemoclaw'.",
        "Gateway Info\n\n  Gateway: openshell\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe("foreign-active");
    expect(
      getGatewayReuseState(
        "Server Status\n\n  Gateway: openshell\n  Status: Connected",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
        "Gateway Info\n\n  Gateway: openshell\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe("foreign-active");
    expect(
      getGatewayReuseState(
        "Gateway status: Disconnected",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe("stale");
    expect(
      getGatewayReuseState(
        "Gateway status: Connected\nGateway: nemoclaw",
        "",
        "Gateway Info\n\n  Gateway: nemoclaw\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe("healthy");
    expect(
      getGatewayReuseState(
        "Gateway status: Connected",
        "",
        "Gateway Info\n\n  Gateway: openshell\n  Gateway endpoint: https://127.0.0.1:8080",
      ),
    ).toBe("foreign-active");
    expect(getGatewayReuseState("", "")).toBe("missing");
  });

  it("prints doctor logs automatically when gateway fails to start (#1605)", testTimeoutOptions(20_000), () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-gateway-diag-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "gateway-diag.cjs");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    // Fake openshell:
    //   gateway start  — emits ANSI color codes + \r\n (mirrors real gateway output), exits 1
    //   doctor logs    — emits ANSI sequences, an OOMKilled message, and a fake nvapi- credential
    //                    to exercise ANSI stripping and redaction in the doctor-log path
    fs.writeFileSync(
      path.join(fakeBin, "openshell"),
      `#!/usr/bin/env bash
if [[ "$*" == *"doctor"*"logs"* ]]; then
  printf "\\033[31mERROR\\033[0m k3s cluster crashed: OOMKilled\\r\\n"
  printf "  Container nemoclaw_k3s ran out of memory\\r\\n"
  printf "  Gateway auth token: nvapi-fakecredential-9999\\r\\n"
  exit 0
fi
if [[ "$*" == "gateway --help" ]]; then
  printf "Commands: start destroy\\n"
  exit 0
fi
if [[ "$*" == *"gateway"*"start"* ]]; then
  printf "\\033[33mDeploying\\033[0m gateway nemoclaw...\\r\\n"
  printf "\\r\\nWaiting for gateway health...\\r\\n"
  exit 1
fi
exit 1
`,
      { mode: 0o755 },
    );

    // Script runs in a child process: patching p-retry to be immediate avoids the
    // 10 s + 30 s minTimeout delays, and NEMOCLAW_HEALTH_POLL_COUNT=0 skips the
    // health-poll loop so the function throws "Gateway failed to start" on the
    // first attempt. With exitOnFailure:true the catch block should auto-print
    // doctor logs to stderr and then call process.exit(1).
    const script = `
const mod = require("module");
const origLoad = mod._load;
mod._load = function(req, parent, isMain) {
  if (req === "p-retry") {
    return async (fn, opts) => {
      try {
        return await fn({ attemptNumber: 1, retriesLeft: 0 });
      } catch (e) {
        if (opts && opts.onFailedAttempt) {
          opts.onFailedAttempt(Object.assign(e, { attemptNumber: 1, retriesLeft: 0 }));
        }
        throw e;
      }
    };
  }
  return origLoad.call(this, req, parent, isMain);
};
Object.defineProperty(process, "platform", { value: "freebsd" });
const { startGateway } = require(${onboardPath});
startGateway(null).catch(() => {});
`;
    fs.writeFileSync(scriptPath, script);

    const nodeExec = process.execPath;
    const result = spawnSync(nodeExec, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_HEALTH_POLL_COUNT: "0",
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    // The process exits 1 because startGateway calls process.exit(1) on failure.
    assert.equal(result.status, 1, `unexpected exit code; stderr:\n${result.stderr}`);

    // Fix 3: doctor logs are auto-printed to stderr.
    assert.ok(
      result.stderr.includes("Gateway logs:"),
      `expected "Gateway logs:" header in stderr:\n${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("OOMKilled"),
      `expected doctor log output in stderr:\n${result.stderr}`,
    );

    // ANSI sequences must be stripped from both stdout (gateway start output) and
    // stderr (doctor logs). A raw \x1b in the output means the regex failed.
    assert.ok(
      !result.stdout.includes("\x1b"),
      `unexpected ANSI escape in stdout:\n${result.stdout}`,
    );
    assert.ok(
      !result.stderr.includes("\x1b"),
      `unexpected ANSI escape in stderr:\n${result.stderr}`,
    );

    // Credentials in doctor logs must be redacted, never printed verbatim.
    assert.ok(
      !result.stderr.includes("nvapi-fakecredential-9999"),
      `credential leaked verbatim in stderr:\n${result.stderr}`,
    );

    // Fix 2: the \r\n -> \naiting rendering artifact must not appear.
    assert.ok(
      !result.stdout.includes("\naiting"),
      `\\naiting artifact present in stdout:\n${result.stdout}`,
    );

    // Fix 1: gateway start output is printed per-line under the header, not as
    // one collapsed blob. "Deploying" and "Waiting" must appear on separate lines.
    const gatewayLines = result.stdout
      .split("\n")
      .filter((l) => l.includes("Deploying") || l.includes("Waiting"));
    assert.ok(
      gatewayLines.length >= 2,
      `expected "Deploying" and "Waiting" on separate lines in stdout:\n${result.stdout}`,
    );
  });

  it("classifies sandbox reuse states from openshell outputs", () => {
    expect(
      getSandboxStateFromOutputs(
        "my-assistant",
        "Name: my-assistant",
        "my-assistant   Ready   2m ago",
      ),
    ).toBe("ready");
    expect(
      getSandboxStateFromOutputs(
        "my-assistant",
        "Name: my-assistant",
        "my-assistant   NotReady   init failed",
      ),
    ).toBe("not_ready");
    expect(
      getSandboxStateFromOutputs(
        "my-assistant",
        "Error: NotFound: sandbox not found",
        "other-sandbox   Ready   2m ago",
      ),
    ).toBe("missing");
    expect(getSandboxStateFromOutputs("my-assistant", "", "")).toBe("missing");
  });

  it("filters local-only artifacts out of the sandbox build context", () => {
    expect(
      shouldIncludeBuildContextPath(
        "/repo/nemoclaw-blueprint",
        "/repo/nemoclaw-blueprint/orchestrator/main.py",
      ),
    ).toBe(true);
    expect(
      shouldIncludeBuildContextPath(
        "/repo/nemoclaw-blueprint",
        "/repo/nemoclaw-blueprint/.venv/bin/python",
      ),
    ).toBe(false);
    expect(
      shouldIncludeBuildContextPath(
        "/repo/nemoclaw-blueprint",
        "/repo/nemoclaw-blueprint/.ruff_cache/cache",
      ),
    ).toBe(false);
    expect(
      shouldIncludeBuildContextPath(
        "/repo/nemoclaw-blueprint",
        "/repo/nemoclaw-blueprint/._pyvenv.cfg",
      ),
    ).toBe(false);
  });

  it("normalizes sandbox name hints from the environment", () => {
    const previous = process.env.NEMOCLAW_SANDBOX_NAME;
    process.env.NEMOCLAW_SANDBOX_NAME = "  My-Assistant  ";
    try {
      expect(getRequestedSandboxNameHint()).toBe("my-assistant");
    } finally {
      if (previous === undefined) {
        delete process.env.NEMOCLAW_SANDBOX_NAME;
      } else {
        process.env.NEMOCLAW_SANDBOX_NAME = previous;
      }
    }
  });

  it("prefers the explicit --name option over NEMOCLAW_SANDBOX_NAME", () => {
    const previous = process.env.NEMOCLAW_SANDBOX_NAME;
    process.env.NEMOCLAW_SANDBOX_NAME = "from-env";
    try {
      expect(getRequestedSandboxNameHint({ sandboxName: "From-Flag" })).toBe("from-flag");
    } finally {
      if (previous === undefined) {
        delete process.env.NEMOCLAW_SANDBOX_NAME;
      } else {
        process.env.NEMOCLAW_SANDBOX_NAME = previous;
      }
    }
  });

  it("detects resume conflicts when --name does not match the recorded sandbox", () => {
    expect(
      getResumeConfigConflicts(
        { sandboxName: "my-assistant", steps: { sandbox: { status: "complete" } } },
        { sandboxName: "second-assistant" },
      ),
    ).toEqual([
      {
        field: "sandbox",
        requested: "second-assistant",
        recorded: "my-assistant",
      },
    ]);
  });

  it("detects resume conflicts when a different sandbox is requested", () => {
    expect(
      getResumeSandboxConflict(
        { sandboxName: "my-assistant", steps: { sandbox: { status: "complete" } } },
        { sandboxName: "other-sandbox" },
      ),
    ).toEqual({
      requestedSandboxName: "other-sandbox",
      recordedSandboxName: "my-assistant",
    });
    expect(
      getResumeSandboxConflict(
        { sandboxName: "other-sandbox", steps: { sandbox: { status: "complete" } } },
        { sandboxName: "other-sandbox" },
      ),
    ).toBe(null);
  });

  it("does not fire a resume conflict from NEMOCLAW_SANDBOX_NAME alone", () => {
    // Interactive resume runs never consult the env var (sandbox creation
    // is already complete in the session, so promptOrDefault is skipped).
    // Reading it here would surface a spurious conflict whenever a user
    // happens to export NEMOCLAW_SANDBOX_NAME in their shell rc.
    const previous = process.env.NEMOCLAW_SANDBOX_NAME;
    process.env.NEMOCLAW_SANDBOX_NAME = "other-sandbox";
    try {
      expect(
        getResumeSandboxConflict({
          sandboxName: "my-assistant",
          steps: { sandbox: { status: "complete" } },
        }),
      ).toBe(null);
    } finally {
      if (previous === undefined) {
        delete process.env.NEMOCLAW_SANDBOX_NAME;
      } else {
        process.env.NEMOCLAW_SANDBOX_NAME = previous;
      }
    }
  });

  it("#2753: ignores an incomplete session sandbox name when checking resume conflicts", () => {
    // A pre-fix on-disk session may carry sandboxName even though the
    // sandbox step never completed. Treating that as a conflict source
    // would block users from running `--resume --name <new>` to recover.
    expect(
      getResumeSandboxConflict(
        { sandboxName: "interrupt-test", steps: { sandbox: { status: "pending" } } },
        { sandboxName: "fresh-name" },
      ),
    ).toBe(null);
    expect(
      getResumeConfigConflicts(
        { sandboxName: "interrupt-test", steps: { sandbox: { status: "pending" } } },
        { sandboxName: "fresh-name" },
      ),
    ).toEqual([]);
  });

  it("returns provider and model hints only for non-interactive runs", () => {
    const previousProvider = process.env.NEMOCLAW_PROVIDER;
    const previousModel = process.env.NEMOCLAW_MODEL;
    process.env.NEMOCLAW_PROVIDER = "cloud";
    process.env.NEMOCLAW_MODEL = "nvidia/test-model";
    try {
      expect(getRequestedProviderHint(true)).toBe("build");
      expect(getRequestedModelHint(true)).toBe("nvidia/test-model");
      expect(getRequestedProviderHint(false)).toBe(null);
      expect(getRequestedModelHint(false)).toBe(null);
    } finally {
      if (previousProvider === undefined) {
        delete process.env.NEMOCLAW_PROVIDER;
      } else {
        process.env.NEMOCLAW_PROVIDER = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.NEMOCLAW_MODEL;
      } else {
        process.env.NEMOCLAW_MODEL = previousModel;
      }
    }
  });

  it("detects resume conflicts for explicit provider and model changes", () => {
    const previousProvider = process.env.NEMOCLAW_PROVIDER;
    const previousModel = process.env.NEMOCLAW_MODEL;
    process.env.NEMOCLAW_PROVIDER = "cloud";
    process.env.NEMOCLAW_MODEL = "nvidia/other-model";
    try {
      // Provider conflict uses a two-stage alias chain in non-interactive mode:
      // "cloud" first resolves to the requested hint, then that hint resolves
      // to the effective provider name "nvidia-prod" for conflict comparison.
      expect(
        getResumeConfigConflicts(
          {
            sandboxName: "my-assistant",
            provider: "nvidia-nim",
            model: "nvidia/nemotron-3-super-120b-a12b",
          },
          { nonInteractive: true },
        ),
      ).toEqual([
        {
          field: "provider",
          requested: "nvidia-prod",
          recorded: "nvidia-nim",
        },
        {
          field: "model",
          requested: "nvidia/other-model",
          recorded: "nvidia/nemotron-3-super-120b-a12b",
        },
      ]);
    } finally {
      if (previousProvider === undefined) {
        delete process.env.NEMOCLAW_PROVIDER;
      } else {
        process.env.NEMOCLAW_PROVIDER = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.NEMOCLAW_MODEL;
      } else {
        process.env.NEMOCLAW_MODEL = previousModel;
      }
    }
  });

  it("detects resume conflicts when a different agent is requested", () => {
    expect(
      getResumeConfigConflicts(
        {
          sandboxName: "my-assistant",
          agent: "openclaw",
        },
        { agent: "hermes" },
      ),
    ).toEqual([
      {
        field: "agent",
        requested: "hermes",
        recorded: "openclaw",
      },
    ]);
  });

  it("allows resume when requested agent matches recorded agent", () => {
    expect(
      getResumeConfigConflicts(
        {
          sandboxName: "my-assistant",
          agent: "hermes",
        },
        { agent: "hermes" },
      ),
    ).toEqual([]);
  });

  it("returns a future-shell PATH hint for user-local openshell installs", () => {
    expect(getFutureShellPathHint("/home/test/.local/bin", "/usr/local/bin:/usr/bin")).toBe(
      'export PATH="/home/test/.local/bin:$PATH"',
    );
  });

  it("skips the future-shell PATH hint when the bin dir is already on PATH", () => {
    expect(
      getFutureShellPathHint(
        "/home/test/.local/bin",
        "/home/test/.local/bin:/usr/local/bin:/usr/bin",
      ),
    ).toBe(null);
  });

  it("logs applied only when the onboard VM DNS monkeypatch changes files", () => {
    const changedLogs: string[] = [];
    applyOnboardVmDnsMonkeypatch(
      "demo",
      { openshellDriver: "vm" },
      {
        apply: () => ({
          attempted: true,
          changed: true,
          ok: true,
          status: "applied",
        }),
        log: (message) => changedLogs.push(message),
        warn: (message) => changedLogs.push(message),
      },
    );

    const unchangedLogs: string[] = [];
    applyOnboardVmDnsMonkeypatch(
      "demo",
      { openshellDriver: "vm" },
      {
        apply: () => ({
          attempted: true,
          changed: false,
          ok: true,
          status: "already-present",
        }),
        log: (message) => unchangedLogs.push(message),
        warn: (message) => unchangedLogs.push(message),
      },
    );

    expect(changedLogs).toEqual(["  ✓ Applied OpenShell VM DNS monkeypatch"]);
    expect(unchangedLogs).toEqual(["  OpenShell VM DNS monkeypatch already present"]);
    expect(unchangedLogs.join("\n")).not.toContain("Applied");
  });

  it("logs skipped VM DNS monkeypatch state for VM sandboxes", () => {
    const logs: string[] = [];

    applyOnboardVmDnsMonkeypatch(
      "demo",
      { openshellDriver: "vm" },
      {
        apply: () => ({
          attempted: false,
          changed: false,
          ok: false,
          reason: "disabled by NEMOCLAW_DISABLE_VM_DNS_MONKEYPATCH=1",
          status: "skipped",
        }),
        log: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      },
    );

    expect(logs).toEqual([
      "  OpenShell VM DNS monkeypatch skipped: disabled by NEMOCLAW_DISABLE_VM_DNS_MONKEYPATCH=1",
    ]);
  });

  it("warns without aborting when the onboard VM DNS monkeypatch fails", () => {
    const warnings: string[] = [];

    expect(() =>
      applyOnboardVmDnsMonkeypatch(
        "demo",
        { openshellDriver: "vm" },
        {
          apply: () => ({
            attempted: true,
            changed: false,
            ok: false,
            reason: "VM rootfs not found",
            status: "failed",
          }),
          log: (message) => warnings.push(message),
          warn: (message) => warnings.push(message),
        },
      ),
    ).not.toThrow();

    expect(warnings).toEqual([
      "  Warning: OpenShell VM DNS monkeypatch did not apply: VM rootfs not found",
    ]);
  });

  it("writes sandbox sync scripts to a temp file for stdin redirection", () => {
    const scriptFile = writeSandboxConfigSyncFile("echo test");
    try {
      expect(scriptFile).toMatch(/nemoclaw-sync.*\.sh$/);
      expect(fs.readFileSync(scriptFile, "utf8")).toBe("echo test\n");
      // Verify the file lives inside a mkdtemp-created directory (not directly in /tmp)
      const parentDir = path.dirname(scriptFile);
      expect(parentDir).not.toBe(os.tmpdir());
      expect(parentDir).toContain("nemoclaw-sync");
      if (process.platform !== "win32") {
        const stat = fs.statSync(scriptFile);
        expect(stat.mode & 0o777).toBe(0o600);
      }
    } finally {
      // mirrors cleanupTempDir() — inline guard to safely remove mkdtemp directory
      const parentDir = path.dirname(scriptFile);
      if (parentDir !== os.tmpdir() && path.basename(parentDir).startsWith("nemoclaw-sync-")) {
        fs.rmSync(parentDir, { recursive: true, force: true });
      }
    }
  });

  it("stages only the files required to build the sandbox image", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-build-context-"));

    try {
      const { buildCtx, stagedDockerfile } = stageOptimizedSandboxBuildContext(repoRoot, tmpDir);

      expect(stagedDockerfile).toBe(path.join(buildCtx, "Dockerfile"));
      expect(fs.existsSync(path.join(buildCtx, "nemoclaw", "package-lock.json"))).toBe(true);
      expect(fs.existsSync(path.join(buildCtx, "nemoclaw", "src"))).toBe(true);
      expect(fs.existsSync(path.join(buildCtx, "nemoclaw-blueprint", ".venv"))).toBe(false);
      expect(fs.existsSync(path.join(buildCtx, "scripts", "nemoclaw-start.sh"))).toBe(true);
      expect(fs.existsSync(path.join(buildCtx, "scripts", "setup.sh"))).toBe(false);
      expect(fs.existsSync(path.join(buildCtx, "nemoclaw", "node_modules"))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("formatEnvAssignment produces NAME=VALUE pairs for sandbox env", () => {
    expect(formatEnvAssignment("CHAT_UI_URL", "http://127.0.0.1:18789")).toBe(
      "CHAT_UI_URL=http://127.0.0.1:18789",
    );
    expect(formatEnvAssignment("EMPTY", "")).toBe("EMPTY=");
  });

  it("compactText collapses whitespace and trims leading/trailing space", () => {
    expect(compactText("  gateway   unreachable  ")).toBe("gateway unreachable");
    expect(compactText("")).toBe("");
    expect(compactText()).toBe("");
    expect(compactText("single")).toBe("single");
    expect(compactText("line1\n  line2\t\tline3")).toBe("line1 line2 line3");
  });

  it("getNavigationChoice recognizes back and exit commands case-insensitively", () => {
    expect(getNavigationChoice("back")).toBe("back");
    expect(getNavigationChoice("BACK")).toBe("back");
    expect(getNavigationChoice("  Back  ")).toBe("back");
    expect(getNavigationChoice("exit")).toBe("exit");
    expect(getNavigationChoice("quit")).toBe("exit");
    expect(getNavigationChoice("QUIT")).toBe("exit");
    expect(getNavigationChoice("")).toBeNull();
    expect(getNavigationChoice("something")).toBeNull();
    expect(getNavigationChoice(null)).toBeNull();
  });

  it("parsePolicyPresetEnv splits comma-separated preset names and trims whitespace", () => {
    expect(parsePolicyPresetEnv("strict,standard")).toEqual(["strict", "standard"]);
    expect(parsePolicyPresetEnv("  strict , standard , ")).toEqual(["strict", "standard"]);
    expect(parsePolicyPresetEnv("")).toEqual([]);
    expect(parsePolicyPresetEnv(null)).toEqual([]);
    expect(parsePolicyPresetEnv("single")).toEqual(["single"]);
  });

  it("summarizeCurlFailure formats curl errors with exit code and truncated detail", () => {
    expect(summarizeCurlFailure(7, "Connection refused", "")).toBe(
      "curl failed (exit 7): Connection refused",
    );
    expect(summarizeCurlFailure(28, "", "")).toBe("curl failed (exit 28)");
    expect(summarizeCurlFailure(0, "", "")).toBe("curl failed (exit 0)");
  });

  it("summarizeProbeFailure prioritizes curl failures then HTTP status then generic message", () => {
    // curl failure takes precedence
    expect(summarizeProbeFailure("body", 500, 7, "Connection refused")).toBe(
      "curl failed (exit 7): Connection refused",
    );
    // HTTP error when no curl failure
    expect(summarizeProbeFailure("Not Found", 404, 0, "")).toBe("HTTP 404: Not Found");
    // Fallback: no curl failure and no body → HTTP status with no body message
    expect(summarizeProbeFailure("", 0, 0, "")).toBe("HTTP 0 with no response body");
    // Non-JSON body gets compacted and returned
    expect(summarizeProbeFailure("  Service  Unavailable  ", 503, 0, "")).toBe(
      "HTTP 503: Service Unavailable",
    );
  });

  it("rejects sandbox names starting with a digit", () => {
    // The validation regex must require names to start with a letter,
    // not a digit — Kubernetes rejects digit-prefixed names downstream.
    const SANDBOX_NAME_REGEX = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

    expect(SANDBOX_NAME_REGEX.test("my-assistant")).toBe(true);
    expect(SANDBOX_NAME_REGEX.test("a")).toBe(true);
    expect(SANDBOX_NAME_REGEX.test("agent-1")).toBe(true);
    expect(SANDBOX_NAME_REGEX.test("test-sandbox-v2")).toBe(true);

    expect(SANDBOX_NAME_REGEX.test("7racii")).toBe(false);
    expect(SANDBOX_NAME_REGEX.test("1sandbox")).toBe(false);
    expect(SANDBOX_NAME_REGEX.test("123")).toBe(false);
    expect(SANDBOX_NAME_REGEX.test("-start-hyphen")).toBe(false);
    expect(SANDBOX_NAME_REGEX.test("end-hyphen-")).toBe(false);
    expect(SANDBOX_NAME_REGEX.test("")).toBe(false);
  });

  it("passes credential names to openshell without embedding secret values in argv", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-inference-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-inference-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(
      path.join(repoRoot, "dist", "lib", "state", "registry.js"),
    );

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: nvidia-nim",
      "  Model: nvidia/nemotron-3-super-120b-a12b",
      "  Version: 1",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.NVIDIA_API_KEY = "nvapi-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "nvidia/nemotron-3-super-120b-a12b", "nvidia-nim");
  console.log(JSON.stringify({ commands, nvidiaApiKey: process.env.NVIDIA_API_KEY || null }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    expect(result.status).toBe(0);
    const payload = parseStdoutJson<{ commands: CommandEntry[]; nvidiaApiKey: string | null }>(
      result.stdout,
    );
    const commands = payload.commands;
    assert.equal(commands.length, 4);
    assert.match(commands[0].command, /gateway select nemoclaw/);
    assert.match(commands[1].command, /provider get/);
    assert.match(commands[2].command, /--credential NVIDIA_API_KEY/);
    assert.doesNotMatch(commands[2].command, /nvapi-secret-value/);
    assert.match(commands[2].command, /provider update/);
    assert.match(commands[3].command, /inference set/);
    assert.equal(payload.nvidiaApiKey, "nvapi-secret-value");
  });

  it("reuses a registered Hermes Provider without re-collecting host credentials", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-hermes-reuse-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-hermes-reuse-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  const normalized = _n(command);
  commands.push({ command: normalized, env: opts.env || null });
  if (normalized.includes("provider get hermes-provider")) {
    return { status: 0, stdout: "Provider: hermes-provider", stderr: "" };
  }
  return { status: 0, stdout: "", stderr: "" };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: hermes-provider",
      "  Model: moonshotai/kimi-k2.6",
      "  Version: 1",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.NOUS_API_KEY = "nous-host-secret";
process.env.OPENAI_API_KEY = "openai-host-secret";
process.env.NEMOCLAW_NON_INTERACTIVE = "1";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "moonshotai/kimi-k2.6", "hermes-provider", "https://inference-api.nousresearch.com/v1", "OPENAI_API_KEY", "oauth");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    expect(result.status).toBe(0);
    const commands = parseStdoutJson<CommandEntry[]>(result.stdout);
    assert.equal(commands.length, 3);
    assert.match(commands[0].command, /gateway select nemoclaw/);
    assert.match(commands[1].command, /provider get hermes-provider/);
    assert.match(commands[2].command, /inference set --no-verify --provider hermes-provider/);
    assert.ok(!commands.some((entry) => /provider (create|update)/.test(entry.command)));
    assert.ok(!commands.some((entry) => entry.env?.NOUS_API_KEY || entry.env?.OPENAI_API_KEY));
    assert.ok(
      !commands.some((entry) => /nous-host-secret|openai-host-secret/.test(entry.command)),
      "host credential values must not appear in argv",
    );
  });

  it("reconciles a registered Hermes Provider when a fresh shell Nous key is selected", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-hermes-update-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-hermes-update-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  const normalized = _n(command);
  commands.push({ command: normalized, env: opts.env || null });
  if (normalized.includes("provider get hermes-provider")) {
    return { status: 0, stdout: "Provider: hermes-provider", stderr: "" };
  }
  return { status: 0, stdout: "", stderr: "" };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: hermes-provider",
      "  Model: moonshotai/kimi-k2.6",
      "  Version: 1",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.NOUS_API_KEY = "nous-host-secret";
delete process.env.OPENAI_API_KEY;
process.env.NEMOCLAW_NON_INTERACTIVE = "1";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference(
    "test-box",
    "moonshotai/kimi-k2.6",
    "hermes-provider",
    "https://inference-api.nousresearch.com/v1",
    "NOUS_API_KEY",
    "api_key",
  );
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    expect(result.status).toBe(0);
    const commands = parseStdoutJson<CommandEntry[]>(result.stdout);
    const update = commands.find((entry) => /provider update hermes-provider/.test(entry.command));
    assert.ok(update);
    assert.match(update.command, /--credential NOUS_API_KEY/);
    assert.equal(update.env?.NOUS_API_KEY, "nous-host-secret");
    assert.ok(
      !commands.some((entry) => /nous-host-secret/.test(entry.command)),
      "shell credential value must not appear in argv",
    );
    assert.match(
      commands.at(-1)?.command || "",
      /inference set --no-verify --provider hermes-provider/,
    );
  });

  it("does not delete saved OpenAI credentials when configuring local vLLM", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-local-vllm-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-local-vllm-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));
    const localInferencePath = JSON.stringify(
      path.join(repoRoot, "dist", "lib", "inference", "local.js"),
    );

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});
const credentials = require(${credentialsPath});
const localInference = require(${localInferencePath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");

const commands = [];
runner.run = (command, opts = {}) => {
  const cmd = _n(command);
  commands.push({ command: cmd, env: opts.env || null });
  if (cmd.includes("provider get")) return { status: 1, stdout: "", stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
};
runner.runCapture = (command) => {
  const cmd = _n(command);
  if (cmd.includes("inference") && cmd.includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: vllm-local",
      "  Model: meta-llama",
      "  Version: 1",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;
localInference.validateLocalProvider = () => ({ ok: true });
localInference.getLocalProviderBaseUrl = () => "http://host.openshell.internal:8000/v1";

credentials.saveCredential("OPENAI_API_KEY", "sk-existing");

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "meta-llama", "vllm-local");
  console.log(JSON.stringify({
    commands,
    savedOpenAiKey: credentials.getCredential("OPENAI_API_KEY"),
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    expect(result.status).toBe(0);
    const payload = parseStdoutJson<{ commands: CommandEntry[]; savedOpenAiKey: string }>(
      result.stdout,
    );
    const providerCommand = payload.commands.find((entry) =>
      entry.command.includes("provider create"),
    );
    assert.ok(providerCommand, "expected local vLLM provider create command");
    assert.match(providerCommand.command, /--credential NEMOCLAW_VLLM_LOCAL_TOKEN/);
    assert.doesNotMatch(providerCommand.command, /--credential OPENAI_API_KEY/);
    assert.equal(providerCommand.env?.NEMOCLAW_VLLM_LOCAL_TOKEN, "dummy");
    assert.equal(payload.savedOpenAiKey, "sk-existing");
  });

  it("detects when the live inference route already matches the requested provider and model", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-inference-ready-"));
    const fakeOpenshell = path.join(tmpDir, "openshell");
    const scriptPath = path.join(tmpDir, "inference-ready-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));

    fs.writeFileSync(
      fakeOpenshell,
      `#!/usr/bin/env bash
if [ "$1" = "inference" ] && [ "$2" = "get" ]; then
  cat <<'EOF'
Gateway inference:

  Route: inference.local
  Provider: nvidia-prod
  Model: nvidia/nemotron-3-super-120b-a12b
  Version: 1
EOF
  exit 0
fi
exit 1
`,
      { mode: 0o755 },
    );

    fs.writeFileSync(
      scriptPath,
      `
const { isInferenceRouteReady } = require(${onboardPath});
console.log(JSON.stringify({
  same: isInferenceRouteReady("nvidia-prod", "nvidia/nemotron-3-super-120b-a12b"),
  otherModel: isInferenceRouteReady("nvidia-prod", "nvidia/other-model"),
  otherProvider: isInferenceRouteReady("openai-api", "nvidia/nemotron-3-super-120b-a12b"),
}));
`,
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${tmpDir}:${process.env.PATH || ""}`,
      },
    });

    try {
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        same: true,
        otherModel: false,
        otherProvider: false,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects when OpenClaw is already configured inside the sandbox", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-openclaw-ready-"));
    const fakeOpenshell = path.join(tmpDir, "openshell");
    const scriptPath = path.join(tmpDir, "openclaw-ready-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));

    fs.writeFileSync(
      fakeOpenshell,
      `#!/usr/bin/env bash
if [ "$1" = "sandbox" ] && [ "$2" = "download" ]; then
  dest="\${@: -1}"
  mkdir -p "$dest/sandbox/.openclaw"
  cat > "$dest/sandbox/.openclaw/openclaw.json" <<'EOF'
{"gateway":{"auth":{"token":"test-token"}}}
EOF
  exit 0
fi
exit 1
`,
      { mode: 0o755 },
    );

    fs.writeFileSync(
      scriptPath,
      `
const { isOpenclawReady } = require(${onboardPath});
console.log(JSON.stringify({
  ready: isOpenclawReady("my-assistant"),
}));
`,
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${tmpDir}:${process.env.PATH || ""}`,
      },
    });

    try {
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ ready: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects when recorded policy presets are already applied", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-policy-ready-"));
    const registryDir = path.join(tmpDir, ".nemoclaw");
    const registryFile = path.join(registryDir, "sandboxes.json");
    const scriptPath = path.join(tmpDir, "policy-ready-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));

    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      registryFile,
      JSON.stringify(
        {
          sandboxes: {
            "my-assistant": {
              name: "my-assistant",
              policies: ["pypi", "npm"],
            },
          },
          defaultSandbox: "my-assistant",
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      scriptPath,
      `
const { arePolicyPresetsApplied } = require(${onboardPath});
console.log(JSON.stringify({
  ready: arePolicyPresetsApplied("my-assistant", ["pypi", "npm"]),
  missing: arePolicyPresetsApplied("my-assistant", ["pypi", "slack"]),
  empty: arePolicyPresetsApplied("my-assistant", []),
}));
`,
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
      },
    });

    try {
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout.trim());
      expect(payload).toEqual({
        ready: true,
        missing: false,
        empty: false,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses native Anthropic provider creation without embedding the secret in argv", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-anthropic-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-anthropic-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  // provider-get returns not-found so we exercise the create path
  if (_n(command).includes("provider get")) return { status: 1 };
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: anthropic-prod",
      "  Model: claude-sonnet-4-5",
      "  Version: 1",
    ].join("\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.ANTHROPIC_API_KEY = "sk-ant-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "claude-sonnet-4-5", "anthropic-prod", "https://api.anthropic.com", "ANTHROPIC_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = parseStdoutJson<CommandEntry[]>(result.stdout);
    assert.equal(commands.length, 4);
    assert.match(commands[0].command, /gateway select nemoclaw/);
    assert.match(commands[1].command, /provider get/);
    assert.match(commands[2].command, /--type anthropic/);
    assert.match(commands[2].command, /--credential ANTHROPIC_API_KEY/);
    assert.doesNotMatch(commands[2].command, /sk-ant-secret-value/);
    assert.match(commands[3].command, /--provider anthropic-prod/);
  });

  it("updates OpenAI-compatible providers without passing an unsupported --type flag", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-openai-update-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-openai-update-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
    ].join("\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.OPENAI_API_KEY = "sk-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = parseStdoutJson<CommandEntry[]>(result.stdout);
    assert.equal(commands.length, 4);
    assert.match(commands[0].command, /gateway select nemoclaw/);
    assert.match(commands[1].command, /provider get/);
    assert.match(commands[2].command, /provider update openai-api/);
    assert.doesNotMatch(commands[2].command, /--type/);
    assert.match(commands[3].command, /inference set --no-verify/);
  });

  it("re-prompts for credentials when openshell inference set fails with authorization errors", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-apply-auth-retry-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-inference-auth-retry-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const credentials = require(${credentialsPath});

const commands = [];
const answers = ["retry", "sk-good"];
let inferenceSetCalls = 0;

credentials.prompt = async () => answers.shift() || "";
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  if (_n(command).includes("inference set")) {
    inferenceSetCalls += 1;
    if (inferenceSetCalls === 1) {
      return { status: 1, stdout: "", stderr: "HTTP 403: forbidden" };
    }
  }
  return { status: 0, stdout: "", stderr: "" };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.OPENAI_API_KEY = "sk-bad";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify({ commands, key: process.env.OPENAI_API_KEY, inferenceSetCalls }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      key: string;
      inferenceSetCalls: number;
      commands: CommandEntry[];
    }>(result.stdout);
    assert.equal(payload.key, "sk-good");
    assert.equal(payload.inferenceSetCalls, 2);
    const providerEnvs = payload.commands
      .filter((entry: CommandEntry) => entry.command.includes("provider"))
      .map((entry: CommandEntry) => entry.env && entry.env.OPENAI_API_KEY)
      .filter(Boolean);
    assert.deepEqual(providerEnvs, ["sk-bad", "sk-good"]);
  });

  it("returns control to provider selection when inference apply recovery chooses back", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-apply-back-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-inference-apply-back-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const credentials = require(${credentialsPath});

const commands = [];
credentials.prompt = async () => "back";
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  if (_n(command).includes("inference set")) {
    return { status: 1, stdout: "", stderr: "HTTP 404: model not found" };
  }
  return { status: 0, stdout: "", stderr: "" };
};
runner.runCapture = () => "";
registry.updateSandbox = () => true;

process.env.OPENAI_API_KEY = "sk-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  const result = await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify({ result, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      result: { retry: "selection" };
      commands: CommandEntry[];
    }>(result.stdout);
    assert.deepEqual(payload.result, { retry: "selection" });
    assert.equal(
      payload.commands.filter((entry: CommandEntry) => entry.command.includes("inference set"))
        .length,
      1,
    );
  });

  it("re-establishes the agent dashboard forward after agent setup health checks", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "lib", "onboard.ts"),
      "utf-8",
    );
    const setupPos = source.indexOf("await agentOnboard.handleAgentSetup");
    const forwardPos = source.indexOf("ensureAgentDashboardForward(sandboxName, agent)", setupPos);

    assert.ok(setupPos !== -1, "agent setup call not found");
    assert.ok(
      forwardPos > setupPos,
      "agent dashboard forward should be re-established after agent health checks",
    );
  });

  it("re-establishes the agent dashboard forward after policies are applied", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "lib", "onboard.ts"),
      "utf-8",
    );
    const policiesPos = source.indexOf("await setupPoliciesWithSelection");
    const completePoliciesPos = source.indexOf(
      'onboardSession.markStepComplete(\n        "policies"',
      policiesPos,
    );
    const forwardPos = source.indexOf(
      "ensureAgentDashboardForward(sandboxName, agent)",
      completePoliciesPos,
    );
    const completeSessionPos = source.indexOf(
      "onboardSession.completeSession",
      completePoliciesPos,
    );

    assert.ok(policiesPos !== -1, "policy setup call not found");
    assert.ok(completePoliciesPos !== -1, "policy completion call not found");
    assert.ok(forwardPos > completePoliciesPos, "agent forward should be reset after policy setup");
    assert.ok(
      forwardPos < completeSessionPos,
      "agent forward should be reset before onboarding is marked complete",
    );
  });

  it("runs fresh stale-gateway cleanup after the sandbox name is known but before createSandbox", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "lib", "onboard.ts"),
      "utf-8",
    );
    const promptPos = source.indexOf(
      "if (!sandboxName) {\n        sandboxName = await promptValidatedSandboxName(agent);",
    );
    const cleanupPos = source.indexOf(
      "stopStaleDashboardListenersForSandbox(registry.listSandboxes().sandboxes, sandboxName);",
      promptPos,
    );
    const createPos = source.indexOf("sandboxName = await createSandbox(", promptPos);

    assert.ok(promptPos !== -1, "sandbox-name resolution block not found");
    assert.ok(cleanupPos > promptPos, "fresh cleanup should run after sandboxName is known");
    assert.ok(cleanupPos < createPos, "fresh cleanup should run before createSandbox allocates a port");
  });

  it("migrates a legacy credentials.json into env so setupInference can register the provider", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-resume-cred-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-resume-credential-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    // Pre-seed a pre-fix plaintext credentials.json. hydrateCredentialEnv
    // stages it non-destructively into process.env via
    // stageLegacyCredentialsToEnv(); the secure unlink only runs from the
    // post-onboard cleanup gate when the staged values are confirmed
    // migrated, so the legacy file must still exist after this test's
    // setupInference call (asserted further down).
    const legacyDir = path.join(tmpDir, ".nemoclaw");
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(legacyDir, "credentials.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-stored-secret" }),
      { mode: 0o600 },
    );

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const legacyFilePath = JSON.stringify(path.join(legacyDir, "credentials.json"));
    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const fs = require("node:fs");

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
    ].join("\n");
  }
  return "";
};
registry.updateSandbox = () => true;

delete process.env.OPENAI_API_KEY;

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify({
    commands,
    openai: process.env.OPENAI_API_KEY || null,
    legacyFileGone: !fs.existsSync(${legacyFilePath}),
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      openai: string;
      commands: CommandEntry[];
      legacyFileGone: boolean;
    }>(result.stdout);
    assert.equal(payload.openai, "sk-stored-secret");
    // setupInference's hydrateCredentialEnv only stages the legacy file
    // (non-destructive). The secure unlink runs only after a full successful
    // onboard, so an interrupted run can be retried without losing the
    // user's only copy of their credentials.
    assert.equal(
      payload.legacyFileGone,
      false,
      "legacy credentials.json must survive the staging-only hydrate path",
    );
    // commands[0]=gateway select, [1]=provider get, [2]=provider update
    const providerUpdate = payload.commands[2];
    assert.ok(providerUpdate, "expected provider update command");
    assert.equal(providerUpdate.env?.OPENAI_API_KEY, "sk-stored-secret");
    assert.doesNotMatch(providerUpdate.command, /sk-stored-secret/);
  });

  it("drops stale local sandbox registry entries when the live sandbox is gone", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-stale-sandbox-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "stale-sandbox-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const registry = require(${registryPath});
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
runner.runCapture = (command) => (_n(command).includes("sandbox get my-assistant") ? "" : "");

registry.registerSandbox({ name: "my-assistant" });

const { pruneStaleSandboxEntry } = require(${onboardPath});

const liveExists = pruneStaleSandboxEntry("my-assistant");
console.log(JSON.stringify({ liveExists, sandbox: registry.getSandbox("my-assistant") }));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payloadLine = result.stdout
      .trim()
      .split("\n")
      .slice()
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));
    assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
    const payload = JSON.parse(payloadLine);
    assert.equal(payload.liveExists, false);
    assert.equal(payload.sandbox, null);
  });

  it(
    "builds the sandbox without uploading an external OpenClaw config file",
    { timeout: 90_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-create-sandbox-"));
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "create-sandbox-check.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
      const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
      const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const commands = [];
const registerCalls = [];
const updateCalls = [];
const defaultCalls = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command);
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 18789 12345 running";
  return "";
};
registry.registerSandbox = (entry) => {
  registerCalls.push(entry);
  return true;
};
registry.updateSandbox = (name, updates) => {
  updateCalls.push({ name, updates });
  return true;
};
registry.setDefault = (name) => {
  defaultCalls.push(name);
  return true;
};
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4");
  console.log(JSON.stringify({ sandboxName, commands, registerCalls, updateCalls, defaultCalls }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: tmpDir,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          NEMOCLAW_NON_INTERACTIVE: "1",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .slice()
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
      const payload = JSON.parse(payloadLine);
      assert.equal(payload.sandboxName, "my-assistant");
      assert.deepEqual(payload.defaultCalls, ["my-assistant"]);
      assert.ok(
        payload.registerCalls.some(
          (entry: Record<string, unknown>) =>
            entry.name === "my-assistant" &&
            entry.model === "gpt-5.4" &&
            Object.prototype.hasOwnProperty.call(entry, "agentVersion"),
        ),
        "expected registry metadata for created sandbox",
      );
      assert.ok(
        payload.updateCalls.every(
          (call: { name: string; updates: Record<string, unknown> }) =>
            call.name === "my-assistant" && call.updates,
        ),
        "expected any registry metadata updates to target the created sandbox",
      );
      const createCommand = payload.commands.find((entry: CommandEntry) =>
        entry.command.includes("sandbox create"),
      );
      assert.ok(createCommand, "expected sandbox create command");
      assert.match(createCommand.command, /nemoclaw-start/);
      assert.doesNotMatch(createCommand.command, /--upload/);
      assert.doesNotMatch(createCommand.command, /OPENCLAW_CONFIG_PATH/);
      assert.doesNotMatch(createCommand.command, /NVIDIA_API_KEY=/);
      assert.doesNotMatch(createCommand.command, /DISCORD_BOT_TOKEN=/);
      assert.doesNotMatch(createCommand.command, /SLACK_BOT_TOKEN=/);
      assert.ok(
        payload.commands.some(
          (entry: CommandEntry) =>
            entry.command.includes("forward start --background 18789 my-assistant") ||
            entry.command.includes("forward start --background 0.0.0.0:18789 my-assistant"),
        ),
        "expected dashboard forward (loopback or WSL 0.0.0.0)",
      );
    },
  );

  it("binds the dashboard forward to 0.0.0.0 when CHAT_UI_URL points to a remote host", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-remote-forward-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-remote-forward.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command);
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 18789 12345 running";
  return "";
};
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  process.env.CHAT_UI_URL = "https://chat.example.com";
  await createSandbox(null, "gpt-5.4");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = parseStdoutJson<CommandEntry[]>(result.stdout);
    assert.ok(
      commands.some((entry: CommandEntry) =>
        entry.command.includes("forward start --background 0.0.0.0:18789 my-assistant"),
      ),
      "expected remote dashboard forward target",
    );
  });

  it("injects NEMOCLAW_DASHBOARD_PORT into sandbox create envArgs when set (#1925)", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-dashboard-port-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "dashboard-port-envargs.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runFile = (file, args = [], opts = {}) => {
  commands.push({ command: _n([file, ...args]), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  // Custom port: dashboard readiness curl uses 19000 (DASHBOARD_PORT from env)
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command);
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 19000 12345 running";
  return "";
};
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    // Strip CHAT_UI_URL so createSandbox falls back to http://127.0.0.1:19000.
    // Without this, a CHAT_UI_URL set in the developer's shell or CI would be
    // inherited, causing chatUiUrl to use the wrong port and making the forward
    // command assertion below fail spuriously.
    const { CHAT_UI_URL: _stripped, ...inheritedEnv } = process.env;
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...inheritedEnv,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
        NEMOCLAW_DASHBOARD_PORT: "19000",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payloadLine = result.stdout
      .trim()
      .split("\n")
      .slice()
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));
    assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
    const payload = JSON.parse(payloadLine);
    const createCommand = payload.commands.find((entry: CommandEntry) =>
      entry.command.includes("sandbox create"),
    );
    assert.ok(createCommand, "expected sandbox create command");
    // Part 1 of fix (#1925): NEMOCLAW_DASHBOARD_PORT must be in envArgs so
    // nemoclaw-start.sh can unconditionally override CHAT_UI_URL at runtime,
    // overriding whatever value the Docker image had baked in.
    assert.match(createCommand.command, /NEMOCLAW_DASHBOARD_PORT=19000/);
    // Forward must use same-port mapping (openshell does not support asymmetric)
    assert.ok(
      payload.commands.some(
        (entry: CommandEntry) =>
          entry.command.includes("forward start --background 19000 my-assistant") ||
          entry.command.includes("forward start --background 0.0.0.0:19000 my-assistant"),
      ),
      "expected dashboard forward for port 19000",
    );
    assert.ok(
      !payload.commands.some((entry: CommandEntry) => entry.command.includes("19000:18789")),
      "forward must not use asymmetric 19000:18789 mapping",
    );
    assert.ok(
      !payload.commands.some((entry: CommandEntry) => entry.command.includes("19000:19000")),
      "forward must not use port:port form (openshell does not support it)",
    );
  });

  it(
    "non-interactive exits with error when existing sandbox is not ready",
    { timeout: 60_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nemoclaw-onboard-noninteractive-notready-"),
      );
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "noninteractive-notready.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const childProcess = require("node:child_process");

runner.run = (command) => {
  if (_n(command).includes("sandbox delete")) {
    throw new Error("unexpected sandbox delete");
  }
  return { status: 0 };
};
runner.runCapture = (command) => {
  // Existing sandbox that is NOT ready
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) return "my-assistant NotReady";
  return "";
};
registry.getSandbox = () => ({ name: "my-assistant", gpuEnabled: false });
childProcess.spawn = () => {
  throw new Error("unexpected sandbox create");
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log("ERROR_DID_NOT_EXIT");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      };
      delete env["NEMOCLAW_RECREATE_SANDBOX"];
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env,
      });

      assert.notEqual(result.status, 0, "expected non-zero exit for not-ready sandbox");
      assert.ok(
        !result.stdout.includes("ERROR_DID_NOT_EXIT"),
        "should have exited before reaching sandbox create",
      );
      const output = (result.stdout || "") + (result.stderr || "");
      assert.ok(
        output.includes("--recreate-sandbox") || output.includes("NEMOCLAW_RECREATE_SANDBOX"),
        "should hint about --recreate-sandbox flag",
      );
    },
  );

  it(
    "recreate-sandbox flag forces deletion and recreation of a ready sandbox",
    { timeout: 60_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-recreate-flag-"));
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "recreate-flag.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  if (_n(command).includes("forward list")) return "";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command, {
      defaultCurlOutput: "ok",
    });
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  return "";
};
registry.getSandbox = () => ({ name: "my-assistant", gpuEnabled: false });
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;

const preflight = require(${JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"))});
preflight.checkPortAvailable = async () => ({ ok: true });

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  process.env.NEMOCLAW_RECREATE_SANDBOX = "1";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: tmpDir,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          NEMOCLAW_NON_INTERACTIVE: "1",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .slice()
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
      const payload = JSON.parse(payloadLine);

      assert.ok(
        payload.commands.some((entry: CommandEntry) => entry.command.includes("sandbox delete")),
        "should delete existing sandbox when --recreate-sandbox is set",
      );
      assert.ok(
        payload.commands.some((entry: CommandEntry) => entry.command.includes("sandbox create")),
        "should create a new sandbox when --recreate-sandbox is set",
      );
    },
  );

  it(
    "recreating a sandbox preserves the user's policy preset selections",
    { timeout: 60_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-recreate-preserves-"));
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "recreate-preserves.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
      const sessionModulePath = JSON.stringify(
        path.join(repoRoot, "dist", "lib", "state", "onboard-session.js"),
      );

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const onboardSession = require(${sessionModulePath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  if (_n(command).includes("forward list")) return "";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command, {
      defaultCurlOutput: "ok",
    });
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  return "";
};

// Existing sandbox has a custom preset selection: only "npm" (not the
// full "balanced" tier). Recreating the sandbox must preserve this
// customisation rather than reverting to the tier defaults.
registry.getSandbox = () => ({
  name: "my-assistant",
  gpuEnabled: false,
  policies: ["npm"],
  policyTier: "balanced",
});
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;

const preflight = require(${JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"))});
preflight.checkPortAvailable = async () => ({ ok: true });

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  process.env.NEMOCLAW_RECREATE_SANDBOX = "1";
  await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  const session = onboardSession.loadSession();
  console.log(JSON.stringify({ policyPresets: session && session.policyPresets }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: tmpDir,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          NEMOCLAW_NON_INTERACTIVE: "1",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .slice()
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
      const payload = JSON.parse(payloadLine);

      assert.deepEqual(
        payload.policyPresets,
        ["npm"],
        "createSandbox should write the previous sandbox's policy presets to the onboard session before destroying it so they can be reapplied after recreation",
      );
    },
  );

  it(
    "interactive mode prompts before reusing an existing ready sandbox",
    { timeout: 60_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-interactive-reuse-"));
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "interactive-reuse.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
      const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const commands = [];
runner.run = (command, opts = {}) => {
  const commandString = Array.isArray(command) ? command.join(" ") : String(command);
  if (_n(command).includes("sandbox download")) {
    const parts = commandString.match(/'([^']*)'/g) || [];
    const downloadDir = Array.isArray(command)
      ? String(command[command.length - 1] || "")
      : parts.length
        ? parts[parts.length - 1].slice(1, -1)
        : null;
    if (downloadDir) {
      fs.mkdirSync(downloadDir, { recursive: true });
      fs.writeFileSync(
        path.join(downloadDir, "config.json"),
        JSON.stringify({ provider: "nvidia-prod", model: "gpt-5.4" }),
      );
    }
  }
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runFile = (file, args = [], opts = {}) => {
  commands.push({ type: "runFile", command: _n([file, ...args]), file, args, env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 18789 12345 running";
  return "";
};
registry.getSandbox = () => ({ name: "my-assistant", gpuEnabled: false });

// Mock prompt to return "y" (reuse)
credentials.prompt = async () => "y";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: args[1]?.[1] || String(args[0]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      // Run WITHOUT NEMOCLAW_NON_INTERACTIVE to exercise interactive path
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      };
      delete env["NEMOCLAW_NON_INTERACTIVE"];
      delete env["NEMOCLAW_RECREATE_SANDBOX"];
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env,
      });

      assert.equal(result.status, 0, result.stderr);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .slice()
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
      const payload = JSON.parse(payloadLine);

      assert.equal(payload.sandboxName, "my-assistant", "should reuse when user answers y");
      assert.ok(
        payload.commands.every((entry: CommandEntry) => !entry.command.includes("sandbox create")),
        "should NOT recreate sandbox when user chooses to reuse",
      );
      assert.ok(
        payload.commands.every((entry: CommandEntry) => !entry.command.includes("sandbox delete")),
        "should NOT delete sandbox when user chooses to reuse",
      );
      assert.ok(
        result.stdout.includes("already exists"),
        "should show 'already exists' message in interactive mode",
      );
    },
  );

  it(
    "interactive mode deletes and recreates sandbox when user confirms drift recreate",
    { timeout: 60_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nemoclaw-onboard-interactive-decline-"),
      );
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "interactive-decline.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
      const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const commands = [];
runner.run = (command, opts = {}) => {
  const commandString = Array.isArray(command) ? command.join(" ") : String(command);
  if (_n(command).includes("sandbox download")) {
    const parts = commandString.match(/'([^']*)'/g) || [];
    const downloadDir = Array.isArray(command)
      ? String(command[command.length - 1] || "")
      : parts.length
        ? parts[parts.length - 1].slice(1, -1)
        : null;
    if (downloadDir) {
      fs.mkdirSync(downloadDir, { recursive: true });
      fs.writeFileSync(
        path.join(downloadDir, "config.json"),
        JSON.stringify({ provider: "openai-prod", model: "gpt-4o" }),
      );
    }
  }
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runFile = (file, args = [], opts = {}) => {
  commands.push({ type: "runFile", command: _n([file, ...args]), file, args, env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  if (_n(command).includes("forward list")) return "";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command, {
      defaultCurlOutput: "ok",
    });
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  return "";
};
registry.getSandbox = () => ({ name: "my-assistant", gpuEnabled: false });
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;

const preflight = require(${JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"))});
preflight.checkPortAvailable = async () => ({ ok: true });

// Mock prompt to return "y" (confirm recreate)
credentials.prompt = async () => "y";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      // Run WITHOUT NEMOCLAW_NON_INTERACTIVE to exercise interactive path
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      };
      delete env["NEMOCLAW_NON_INTERACTIVE"];
      delete env["NEMOCLAW_RECREATE_SANDBOX"];
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env,
      });

      assert.equal(result.status, 0, result.stderr);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .slice()
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
      const payload = JSON.parse(payloadLine);

      assert.ok(
        payload.commands.some((entry: CommandEntry) =>
          /sandbox.*delete/.test(String(entry.command)),
        ),
        "should delete existing sandbox when user confirms recreate",
      );
      assert.ok(
        payload.commands.some((entry: CommandEntry) =>
          /sandbox.*create/.test(String(entry.command)),
        ),
        "should create a new sandbox when user confirms recreate",
      );
      assert.ok(
        result.stdout.includes("requested inference selection changed"),
        "should show drift warning before prompting",
      );
    },
  );

  it(
    "interactive mode auto-recreates when existing sandbox is not ready",
    { timeout: 60_000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nemoclaw-onboard-interactive-notready-"),
      );
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "interactive-notready.js");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
      const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const commands = [];
let sandboxDeleted = false;
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  if (_n(command).includes("sandbox delete")) sandboxDeleted = true;
  return { status: 0 };
};
runner.runCapture = (command) => {
  // Existing sandbox that is NOT ready initially, becomes Ready after recreation
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) {
    return sandboxDeleted ? "my-assistant Ready" : "my-assistant NotReady";
  }
  if (_n(command).includes("forward list")) return "";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command, {
      defaultCurlOutput: "ok",
    });
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  return "";
};
registry.getSandbox = () => ({ name: "my-assistant", gpuEnabled: false });
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;

const preflight = require(${JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"))});
preflight.checkPortAvailable = async () => ({ ok: true });

// User confirms recreation when prompted
credentials.prompt = async () => "y";

const fakeSpawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};
childProcess.spawn = fakeSpawn;

// Also patch spawn inside the compiled sandbox-create-stream module.
// It imports spawn at load time from "node:child_process", so patching the
// childProcess object above does not reach it. Patch the cached module
// directly so streamSandboxCreate (called by createSandbox) doesn't spawn
// a real bash process that tries to hit a live gateway.
const sandboxCreateStreamMod = require(${JSON.stringify(path.join(repoRoot, "dist", "lib", "sandbox", "create-stream.js"))});
const _origStreamCreate = sandboxCreateStreamMod.streamSandboxCreate;
sandboxCreateStreamMod.streamSandboxCreate = (command, env, options = {}) => {
  return _origStreamCreate(command, env, { ...options, spawnImpl: fakeSpawn });
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      // Run WITHOUT NEMOCLAW_NON_INTERACTIVE to exercise interactive path
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      };
      delete env["NEMOCLAW_NON_INTERACTIVE"];
      delete env["NEMOCLAW_RECREATE_SANDBOX"];
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env,
      });

      assert.equal(result.status, 0, result.stderr);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .slice()
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
      const payload = JSON.parse(payloadLine);

      assert.ok(
        payload.commands.some((entry: CommandEntry) => entry.command.includes("sandbox delete")),
        "should delete not-ready sandbox after user confirms",
      );
      assert.ok(
        payload.commands.some((entry: CommandEntry) => entry.command.includes("sandbox create")),
        "should recreate sandbox when existing one is not ready",
      );
      assert.ok(result.stdout.includes("not ready"), "should mention sandbox is not ready");
    },
  );
  it("upsertProvider creates a new provider and returns ok on success", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-upsert-provider-create-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "upsert-provider-create.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const commands = [];
runner.run = (command, opts = {}) => {
  commands.push(_n(command));
  // First call is provider-get (not found), second is provider-create (success)
  if (_n(command).includes("provider get")) return { status: 1, stdout: "", stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
};
const { upsertProvider } = require(${onboardPath});
const result = upsertProvider("discord-bridge", "generic", "DISCORD_BOT_TOKEN", null, { DISCORD_BOT_TOKEN: "fake" });
console.log(JSON.stringify({ result, commands }));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      result: { ok: true };
      commands: string[];
    }>(result.stdout);
    assert.deepEqual(payload.result, { ok: true });
    assert.equal(payload.commands.length, 2);
    assert.match(payload.commands[0], /provider get/);
    assert.match(payload.commands[1], /provider create --name discord-bridge/);
    assert.match(payload.commands[1], /--credential DISCORD_BOT_TOKEN/);
  });

  it("upsertProvider does not add its own log line on top of runner output (#1506)", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-upsert-no-dup-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "upsert-no-dup.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
runner.run = (command, opts = {}) => {
  // First call is provider-get (not found)
  if (_n(command).includes("provider get")) return { status: 1, stdout: "", stderr: "" };
  // Simulate runner passthrough: writeRedactedResult writes stdout to terminal
  process.stdout.write("✓ Created provider test-bridge\\n");
  return { status: 0, stdout: "✓ Created provider test-bridge", stderr: "" };
};
const { upsertProvider } = require(${onboardPath});
upsertProvider("test-bridge", "generic", "TEST_TOKEN", null, { TEST_TOKEN: "tok" });
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout
      .split("\n")
      .filter((l) => l.includes("Created provider test-bridge"));
    assert.equal(lines.length, 1, `Expected 1 log line but got ${lines.length}: ${result.stdout}`);
  });

  it("upsertProvider updates existing provider instead of creating (#1155)", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-upsert-provider-update-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "upsert-provider-update.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const commands = [];
runner.run = (command, opts = {}) => {
  commands.push(_n(command));
  // provider-get succeeds (provider exists), then update succeeds
  return { status: 0, stdout: "", stderr: "" };
};
const { upsertProvider } = require(${onboardPath});
const result = upsertProvider("inference", "openai", "NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1");
console.log(JSON.stringify({ result, commands }));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      result: { ok: true };
      commands: string[];
    }>(result.stdout);
    assert.deepEqual(payload.result, { ok: true });
    assert.equal(payload.commands.length, 2);
    assert.match(payload.commands[0], /provider get/);
    assert.match(payload.commands[1], /provider update/);
    assert.match(
      payload.commands[1],
      /--config OPENAI_BASE_URL=https:\/\/integrate.api.nvidia.com\/v1/,
    );
  });

  it("upsertProvider returns error details when create or update fails", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-upsert-provider-fail-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "upsert-provider-fail.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
runner.run = (command, opts = {}) => {
  // provider-get says not found, then create fails
  if (_n(command).includes("provider get")) return { status: 1, stdout: "", stderr: "" };
  return { status: 1, stdout: "", stderr: "gateway unreachable" };
};
const { upsertProvider } = require(${onboardPath});
const result = upsertProvider("bad-provider", "generic", "SOME_KEY", null);
console.log(JSON.stringify(result));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      ok: false;
      status: number;
      message: string;
    }>(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, 1);
    assert.match(payload.message, /gateway unreachable/);
  });

  it("providerExistsInGateway returns true when provider exists", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-provider-exists-true-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "provider-exists-true.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
runner.run = (command) => {
  return { status: 0, stdout: "Provider: discord-bridge", stderr: "" };
};
const { providerExistsInGateway } = require(${onboardPath});
console.log(JSON.stringify({ exists: providerExistsInGateway("discord-bridge") }));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{ exists: boolean }>(result.stdout);
    assert.equal(payload.exists, true);
  });

  it("hydrateCredentialEnv writes stored credentials into process.env for host-side bridges", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-hydrate-cred-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "hydrate-cred.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const credentials = require(${credentialsPath});
// Mock getCredential and resolveProviderCredential to return a stored value.
// hydrateCredentialEnv delegates to resolveProviderCredential which calls
// getCredential internally.  Since resolveProviderCredential uses the local
// function reference (not module.exports.getCredential), we must also mock
// resolveProviderCredential on the module object so the onboard.ts import
// picks up the mock.  See #2306.
const mockGetCredential = (name) => name === "TELEGRAM_BOT_TOKEN" ? "stored-telegram-token" : null;
credentials.getCredential = mockGetCredential;
credentials.resolveProviderCredential = (envName) => {
  const value = mockGetCredential(envName);
  if (value) process.env[envName] = value;
  return value || null;
};
const { hydrateCredentialEnv } = require(${onboardPath});

// Should return null for falsy input
const nullResult = hydrateCredentialEnv(null);

// Should hydrate from stored credential and set process.env
delete process.env.TELEGRAM_BOT_TOKEN;
const hydrated = hydrateCredentialEnv("TELEGRAM_BOT_TOKEN");

// Should return null when credential is not stored
const missing = hydrateCredentialEnv("NONEXISTENT_KEY");

console.log(JSON.stringify({
  nullResult,
  hydrated,
  envSet: process.env.TELEGRAM_BOT_TOKEN,
  missing,
}));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      nullResult: null;
      hydrated: string;
      envSet: string;
      missing: null;
    }>(result.stdout);
    assert.equal(payload.nullResult, null, "should return null for null input");
    assert.equal(
      payload.hydrated,
      "stored-telegram-token",
      "should return stored credential value",
    );
    assert.equal(
      payload.envSet,
      "stored-telegram-token",
      "should set process.env with stored value",
    );
    assert.equal(payload.missing, null, "should return null when credential is not stored");
  });

  it("providerExistsInGateway returns false when provider is missing", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-provider-exists-false-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "provider-exists-false.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = `
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
runner.run = (command) => {
  return { status: 1, stdout: "", stderr: "provider not found" };
};
const { providerExistsInGateway } = require(${onboardPath});
console.log(JSON.stringify({ exists: providerExistsInGateway("nonexistent") }));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{ exists: boolean }>(result.stdout);
    assert.equal(payload.exists, false);
  });

  it(
    "continues once the sandbox is Ready even if the create stream never closes",
    { timeout: 20000 },
    async () => {
      const repoRoot = path.join(import.meta.dirname, "..");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-create-ready-"));
      const fakeBin = path.join(tmpDir, "bin");
      const scriptPath = path.join(tmpDir, "create-sandbox-ready-check.js");
      const payloadPath = path.join(tmpDir, "payload.json");
      const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
      const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
      const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
      const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
      const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });

      const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");

const commands = [];
let sandboxListCalls = 0;
const keepAlive = setInterval(() => {}, 1000);
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "";
  if (_n(command).includes("sandbox list")) {
    sandboxListCalls += 1;
    return sandboxListCalls >= 2 ? "my-assistant Ready" : "my-assistant Pending";
  }
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command);
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 18789 12345 running";
  return "";
};
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.unrefCalls = 0;
  child.stdout.destroyCalls = 0;
  child.stderr.destroyCalls = 0;
  child.stdout.destroy = () => {
    child.stdout.destroyCalls += 1;
  };
  child.stderr.destroy = () => {
    child.stderr.destroyCalls += 1;
  };
  child.unref = () => {
    child.unrefCalls += 1;
  };
  child.kill = (signal) => {
    child.killCalls.push(signal);
    process.nextTick(() => child.emit("close", signal === "SIGTERM" ? 0 : 1));
    return true;
  };
  commands.push({ command: _n(args[1][1]), env: args[2]?.env || null, child });
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4");
  const createCommand = commands.find((entry) => entry.command.includes("sandbox create"));
  fs.writeFileSync(${JSON.stringify(payloadPath)}, JSON.stringify({
    sandboxName,
    sandboxListCalls,
    killCalls: createCommand.child.killCalls,
    unrefCalls: createCommand.child.unrefCalls,
    stdoutDestroyCalls: createCommand.child.stdout.destroyCalls,
    stderrDestroyCalls: createCommand.child.stderr.destroyCalls,
  }));
  clearInterval(keepAlive);
})().catch((error) => {
  clearInterval(keepAlive);
  console.error(error);
  process.exit(1);
});
`;
      fs.writeFileSync(scriptPath, script);

      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: tmpDir,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          NEMOCLAW_NON_INTERACTIVE: "1",
          OPENSHELL_DRIVERS: "docker",
        },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
      assert.equal(payload.sandboxName, "my-assistant");
      assert.ok(payload.sandboxListCalls >= 2);
      assert.deepEqual(payload.killCalls, ["SIGTERM"]);
      assert.equal(payload.unrefCalls, 1);
      assert.equal(payload.stdoutDestroyCalls, 1);
      assert.equal(payload.stderrDestroyCalls, 1);
    },
  );

  it("restores the dashboard forward when onboarding reuses an existing ready sandbox", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-reuse-forward-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "reuse-sandbox-forward.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "my-assistant";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 18789 12345 running";
  return "";
};
registry.getSandbox = () => ({ name: "my-assistant", gpuEnabled: false });

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  process.env.CHAT_UI_URL = "https://chat.example.com";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseStdoutJson<{
      sandboxName: string;
      commands: CommandEntry[];
    }>(result.stdout);
    assert.equal(payload.sandboxName, "my-assistant");
    assert.ok(
      payload.commands.some((entry: CommandEntry) =>
        entry.command.includes("forward start --background 0.0.0.0:18789 my-assistant"),
      ),
      "expected dashboard forward restore on sandbox reuse",
    );
    assert.ok(
      payload.commands.every((entry: CommandEntry) => !entry.command.includes("sandbox create")),
      "did not expect sandbox create when reusing existing sandbox",
    );
  });

  it("prints resume guidance when sandbox image upload times out", () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      printSandboxCreateRecoveryHints(
        [
          "  Pushing image openshell/sandbox-from:123 into gateway nemoclaw",
          "  [progress] Uploaded to gateway",
          "Error: failed to read image export stream",
          "Timeout error",
        ].join("\n"),
      );
    } finally {
      console.error = originalError;
    }

    const joined = errors.join("\n");
    assert.match(joined, /Hint: image upload into the OpenShell gateway timed out\./);
    assert.match(joined, /Recovery: nemoclaw onboard --resume/);
    assert.match(
      joined,
      /Progress reached the gateway upload stage, so resume may be able to reuse existing gateway state\./,
    );
  });

  it("prints resume guidance when sandbox image upload resets after transfer progress", () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      printSandboxCreateRecoveryHints(
        [
          "  Pushing image openshell/sandbox-from:123 into gateway nemoclaw",
          "  [progress] Uploaded to gateway",
          "Error: Connection reset by peer",
        ].join("\n"),
      );
    } finally {
      console.error = originalError;
    }

    const joined = errors.join("\n");
    assert.match(joined, /Hint: the image push\/import stream was interrupted\./);
    assert.match(joined, /Recovery: nemoclaw onboard --resume/);
    assert.match(
      joined,
      /The image appears to have reached the gateway before the stream failed\./,
    );
  });

  it("accepts gateway inference when system inference is separately not configured", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-inference-get-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "inference-get-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
      "",
      "System inference:",
      "",
      "  Not configured",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;
process.env.OPENAI_API_KEY = "sk-secret-value";
process.env.OPENSHELL_GATEWAY = "nemoclaw";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = parseStdoutJson<string[]>(result.stdout);
    // gateway select + provider get + provider update + inference set
    assert.equal(commands.length, 4);
  });

  it("accepts gateway inference output that omits the Route line", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-inference-route-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "inference-route-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("inference") && _n(command).includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
      "",
      "System inference:",
      "",
      "  Not configured",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;
process.env.OPENAI_API_KEY = "sk-secret-value";
process.env.OPENSHELL_GATEWAY = "nemoclaw";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = parseStdoutJson<string[]>(result.stdout);
    // gateway select + provider get + provider update + inference set
    assert.equal(commands.length, 4);
  });

  it("uses the custom Dockerfile parent directory as build context when --from is given", testTimeoutOptions(60_000), async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-from-dockerfile-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-from.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    // Create a minimal custom Dockerfile in a temporary directory
    const customBuildDir = path.join(tmpDir, "custom-image");
    fs.mkdirSync(customBuildDir, { recursive: true });
    fs.writeFileSync(
      path.join(customBuildDir, "Dockerfile"),
      [
        "FROM ubuntu:22.04",
        "ARG NEMOCLAW_MODEL=nvidia/nemotron-super-49b-v1",
        "ARG NEMOCLAW_PROVIDER_KEY=nvidia",
        "ARG NEMOCLAW_PRIMARY_MODEL_REF=nvidia/nemotron-super-49b-v1",
        "ARG CHAT_UI_URL=http://127.0.0.1:18789",
        "ARG NEMOCLAW_INFERENCE_BASE_URL=https://inference.local/v1",
        "ARG NEMOCLAW_INFERENCE_API=openai-completions",
        "ARG NEMOCLAW_INFERENCE_COMPAT_B64=e30=",
        "ARG NEMOCLAW_BUILD_ID=default",
        "RUN echo done",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(customBuildDir, "extra.txt"), "extra build context file");
    fs.writeFileSync(path.join(customBuildDir, "large.bin"), "small file with large mocked stat");
    fs.mkdirSync(path.join(customBuildDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(customBuildDir, "node_modules", "pkg", "ignored.txt"), "skip me");
    fs.mkdirSync(path.join(customBuildDir, ".ssh"), { recursive: true });
    fs.writeFileSync(path.join(customBuildDir, ".ssh", "id_ed25519"), "fake test key");
    fs.mkdirSync(path.join(customBuildDir, ".aws"), { recursive: true });
    fs.writeFileSync(path.join(customBuildDir, ".aws", "credentials"), "fake test credentials");
    fs.mkdirSync(path.join(customBuildDir, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(customBuildDir, "secrets", "token.txt"), "fake test token");
    fs.writeFileSync(path.join(customBuildDir, ".env.local"), "EXAMPLE=fake");
    fs.writeFileSync(
      path.join(customBuildDir, ".npmrc"),
      "registry=https://registry.example.test\n",
    );
    fs.writeFileSync(path.join(customBuildDir, "model.pem"), "fake test certificate");
    fs.writeFileSync(path.join(customBuildDir, "credentials.json"), "{}");

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const customDockerfilePath = JSON.stringify(path.join(customBuildDir, "Dockerfile"));

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const commands = [];
let hasExtraFileAtSpawn = false;
let stagedIgnoredFilesAtSpawn = null;
const largeFilePath = ${JSON.stringify(path.join(customBuildDir, "large.bin"))};
const originalStatSync = fs.statSync;
fs.statSync = (target, ...rest) => {
  const stats = originalStatSync(target, ...rest);
  if (target === largeFilePath) {
    return { ...stats, size: 101_000_000 };
  }
  return stats;
};
runner.run = (command, opts = {}) => {
  commands.push({ command: _n(command), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (_n(command).includes("sandbox get my-assistant")) return "";
  if (_n(command).includes("sandbox list")) return "my-assistant Ready";
  {
    const sandboxExecCurl = require(${onboardScriptMocksPath}).mockSandboxExecCurl(command);
    if (sandboxExecCurl !== null) return sandboxExecCurl;
  }
  if (_n(command).includes("forward list")) return "my-assistant 127.0.0.1 18789 12345 running";
  return "";
};
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

childProcess.spawn = (...args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const cmd = _n(args[1][1]);
  commands.push({ command: cmd, env: args[2]?.env || null });
  // Observe the staged build context state while the sandbox create is in
  // flight — onboard deletes it once streamSandboxCreate resolves.
  const fromMatch = cmd.match(/--from\s+(\S+)/);
  if (fromMatch) {
    const stagedDir = path.dirname(fromMatch[1]);
    hasExtraFileAtSpawn = fs.existsSync(path.join(stagedDir, "extra.txt"));
    stagedIgnoredFilesAtSpawn = {
      nodeModules: fs.existsSync(path.join(stagedDir, "node_modules")),
      ssh: fs.existsSync(path.join(stagedDir, ".ssh")),
      aws: fs.existsSync(path.join(stagedDir, ".aws")),
      secrets: fs.existsSync(path.join(stagedDir, "secrets")),
      env: fs.existsSync(path.join(stagedDir, ".env.local")),
      npmrc: fs.existsSync(path.join(stagedDir, ".npmrc")),
      pem: fs.existsSync(path.join(stagedDir, "model.pem")),
      credentialsJson: fs.existsSync(path.join(stagedDir, "credentials.json")),
    };
  }
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("Created sandbox: my-assistant\n"));
    child.emit("close", 0);
  });
  return child;
};

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  const sandboxName = await createSandbox(null, "gpt-5.4", "openai-api", null, "my-assistant", null, null, ${customDockerfilePath});
  console.log(JSON.stringify({ sandboxName, hasExtraFile: hasExtraFileAtSpawn, stagedIgnoredFiles: stagedIgnoredFilesAtSpawn }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payloadLine = result.stdout
      .trim()
      .split("\n")
      .slice()
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));
    assert.ok(payloadLine, `expected JSON payload in stdout:\n${result.stdout}`);
    const payload = JSON.parse(payloadLine);
    assert.equal(payload.sandboxName, "my-assistant");
    assert.match(result.stdout, /Using custom Dockerfile:/);
    assert.match(result.stdout, /Docker build context:/);
    assert.match(result.stdout, /Docker build context:.*custom-image/);
    assert.match(result.stderr, /WARN: build context contains about 101\.0 MB/);
    assert.equal(
      payload.hasExtraFile,
      true,
      "extra.txt from custom build context should be staged",
    );
    assert.deepEqual(payload.stagedIgnoredFiles, {
      nodeModules: false,
      ssh: false,
      aws: false,
      secrets: false,
      env: false,
      npmrc: false,
      pem: false,
      credentialsJson: false,
    });
  });

  it("exits with an error when the --from Dockerfile path does not exist", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-from-missing-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-missing.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const missingPath = JSON.stringify(path.join(tmpDir, "does-not-exist", "Dockerfile"));

    const script = String.raw`
const runner = require(${runnerPath});
const _n = (c) => (Array.isArray(c) ? c.join(" ") : String(c)).replace(/'/g, "");
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});

runner.run = () => ({ status: 0 });
runner.runCapture = () => "";
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  await createSandbox(null, "gpt-5.4", "openai-api", null, "my-assistant", null, null, ${missingPath});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 1, "should exit 1 when fromDockerfile path is missing");
    assert.match(result.stderr, /Custom Dockerfile not found/);
  });

  it("exits with an error when the --from Dockerfile path is a directory", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-from-dir-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-dir.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const directoryPath = JSON.stringify(tmpDir);

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});

runner.run = () => ({ status: 0 });
runner.runCapture = () => "";
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  await createSandbox(null, "gpt-5.4", "openai-api", null, "my-assistant", null, null, ${directoryPath});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 1, "should exit 1 when fromDockerfile path is a directory");
    assert.match(result.stderr, /Custom Dockerfile path is not a file/);
  });

  it("exits clearly when the --from Dockerfile is inside an ignored context path", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-from-ignored-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-ignored.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));
    const ignoredDir = path.join(tmpDir, "node_modules", "pkg");

    fs.mkdirSync(ignoredDir, { recursive: true });
    fs.writeFileSync(path.join(ignoredDir, "Dockerfile"), "FROM ubuntu:22.04\n");
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const customDockerfilePath = JSON.stringify(path.join(ignoredDir, "Dockerfile"));

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});

runner.run = () => ({ status: 0 });
runner.runCapture = () => "";
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  await createSandbox(null, "gpt-5.4", "openai-api", null, "my-assistant", null, null, ${customDockerfilePath});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 1, "should exit 1 when fromDockerfile is ignored");
    assert.match(result.stderr, /inside an ignored build-context path/);
  });

  it("cleans up the custom build context when staging fails", async () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-from-cleanup-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-cleanup.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "state", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials", "store.js"));
    const customBuildDir = path.join(tmpDir, "custom-image");

    fs.mkdirSync(customBuildDir, { recursive: true });
    fs.writeFileSync(path.join(customBuildDir, "Dockerfile"), "FROM ubuntu:22.04\n");
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });

    const customDockerfilePath = JSON.stringify(path.join(customBuildDir, "Dockerfile"));
    const customBuildDirLiteral = JSON.stringify(customBuildDir);

    const script = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const runner = require(${runnerPath});
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});

let createdBuildContext = null;
const originalMkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (prefix, ...rest) => {
  const dir = originalMkdtempSync(prefix, ...rest);
  if (String(prefix).includes("nemoclaw-build-")) {
    createdBuildContext = dir;
  }
  return dir;
};
const originalCpSync = fs.cpSync;
fs.cpSync = (src, dest, options) => {
  if (src === ${customBuildDirLiteral}) {
    fs.writeFileSync(path.join(dest, "partial.txt"), "partial custom context");
    throw new Error("simulated custom context copy failure");
  }
  return originalCpSync(src, dest, options);
};

runner.run = () => ({ status: 0 });
runner.runCapture = () => "";
registry.registerSandbox = () => true;
registry.updateSandbox = () => true;
registry.setDefault = () => true;
registry.removeSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";

const { createSandbox } = require(${onboardPath});

(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  try {
    await createSandbox(null, "gpt-5.4", "openai-api", null, "my-assistant", null, null, ${customDockerfilePath});
  } catch (error) {
    console.log(JSON.stringify({
      removed: Boolean(createdBuildContext) && !fs.existsSync(createdBuildContext),
      message: error.message,
    }));
    return;
  }
  console.error("expected createSandbox to throw");
  process.exit(1);
})();
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NEMOCLAW_NON_INTERACTIVE: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim().split("\n").pop()!);
    assert.equal(payload.removed, true, result.stdout);
    assert.match(payload.message, /simulated custom context copy failure/);
  });

  it("regression #1881: registry.updateSandbox(model/provider) is called AFTER createSandbox", () => {
    // updateSandbox() silently no-ops when the entry does not exist yet.
    // This asserts that the model/provider update comes AFTER createSandbox()
    // returns, not before registerSandbox() is called (the original bug).
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "lib", "onboard.ts"),
      "utf-8",
    );
    const createSandboxPos = source.indexOf("sandboxName = await createSandbox(");
    assert.ok(createSandboxPos !== -1, "createSandbox call not found in onboard.ts");
    const updateAfterCreate = source.indexOf(
      "registry.updateSandbox(sandboxName, {",
      createSandboxPos,
    );
    assert.ok(
      updateAfterCreate !== -1,
      "registry.updateSandbox(model, provider) must appear AFTER createSandbox() — regression #1881",
    );
  });

  // ── Base image digest pinning (#1904) ──────────────────────────

  it("regression #1904: pullAndResolveBaseImageDigest uses sandbox-base registry", () => {
    // Structural check: verify the constant matches the Dockerfile default
    // and does NOT reference the openshell-community registry.
    assert.ok(
      SANDBOX_BASE_IMAGE.includes("nemoclaw/sandbox-base"),
      `SANDBOX_BASE_IMAGE must reference nemoclaw/sandbox-base, got: ${SANDBOX_BASE_IMAGE}`,
    );
    assert.ok(
      !SANDBOX_BASE_IMAGE.includes("openshell-community"),
      `SANDBOX_BASE_IMAGE must NOT reference openshell-community, got: ${SANDBOX_BASE_IMAGE}`,
    );
  });

  it("regression #1904: createSandbox calls pullAndResolveBaseImageDigest before patchStagedDockerfile", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "lib", "onboard.ts"),
      "utf-8",
    );
    const pullPos = source.search(/const resolved = pullAndResolveBaseImageDigest\s*\(/);
    assert.ok(pullPos !== -1, "pullAndResolveBaseImageDigest call not found in onboard.ts");
    const patchPos = source.indexOf("patchStagedDockerfile(", pullPos);
    assert.ok(
      patchPos > pullPos,
      "pullAndResolveBaseImageDigest must be called BEFORE patchStagedDockerfile — regression #1904",
    );
  });

  it("findDashboardForwardOwner parses openshell forward list column format (#2169)", () => {
    // Canonical openshell forward list output: SANDBOX  BIND  PORT  PID  STATUS
    const forwardList = [
      "SANDBOX     BIND             PORT   PID     STATUS",
      "test21      127.0.0.1        18789  42101   active",
      "other       127.0.0.1        18790  42102   active",
    ].join("\n");

    // Port in use by another sandbox → return that sandbox's name
    assert.equal(findDashboardForwardOwner(forwardList, "18789"), "test21");
    assert.equal(findDashboardForwardOwner(forwardList, "18790"), "other");
    // Port not in the list → null
    assert.equal(findDashboardForwardOwner(forwardList, "18791"), null);
    // Empty / missing input → null (no false positives)
    assert.equal(findDashboardForwardOwner("", "18789"), null);
    assert.equal(findDashboardForwardOwner(null, "18789"), null);
    assert.equal(findDashboardForwardOwner(undefined, "18789"), null);
    // Port string appearing as a substring somewhere other than column 2 must NOT
    // match — guard against false-positive substring matches.
    const falsePositive = "sandbox18789 127.0.0.1 42001 9999 active";
    assert.equal(findDashboardForwardOwner(falsePositive, "18789"), null);
  });

  describe("findAvailableDashboardPort port-conflict detection (#3260)", () => {
    const stubBound = (...bound: number[]) => {
      const set = new Set(bound);
      return (port: number) => set.has(port);
    };

    it("returns the preferred port when no forward owns it and the host says it is free", () => {
      assert.equal(
        findAvailableDashboardPort("cursor", 18789, "", stubBound()),
        18789,
      );
    });

    it("skips the preferred port when host reports it bound and falls through to the range scan", () => {
      // The proactive probe in isPortBoundOnHost can now see root-owned
      // listeners (sudo lsof) and Node-bind-failure listeners that the
      // bare lsof missed; the allocator must skip those ports just as it
      // skips ports owned by other forwards.
      assert.equal(
        findAvailableDashboardPort("cursor", 18789, "", stubBound(18789)),
        18790,
      );
    });

    it("skips ports owned by other sandboxes and host-bound ports together", () => {
      const forwardList = [
        "SANDBOX  BIND  PORT  PID  STATUS",
        "alpha    127.0.0.1  18789  111  running",
      ].join("\n");
      assert.equal(
        findAvailableDashboardPort("cursor", 18789, forwardList, stubBound(18790)),
        18791,
      );
    });

    it("returns the preferred port when this sandbox already owns it", () => {
      const forwardList = [
        "SANDBOX  BIND  PORT  PID  STATUS",
        "cursor   127.0.0.1  18789  111  running",
      ].join("\n");
      assert.equal(
        findAvailableDashboardPort("cursor", 18789, forwardList, stubBound(18789)),
        18789,
      );
    });

    it("throws when every port in the range is occupied by other sandboxes", () => {
      const lines = ["SANDBOX  BIND  PORT  PID  STATUS"];
      for (let p = 18789; p <= 18799; p++) {
        lines.push(`other${p}    127.0.0.1  ${p}  ${p}  running`);
      }
      assert.throws(
        () => findAvailableDashboardPort("cursor", 18789, lines.join("\n"), stubBound()),
        /All dashboard ports in range 18789-18799 are occupied/,
      );
    });

    it("includes host-bound ports in the exhaustion error so users know what's blocking them", () => {
      // When every candidate is skipped by isPortBoundCheck rather than by
      // an OpenShell forward, the error must still surface which ports are
      // bound — otherwise users see "all ports are occupied" with an empty
      // owner list and no remediation hint (CodeRabbit catch on #3260).
      const allBound = new Set<number>();
      for (let p = 18789; p <= 18799; p++) allBound.add(p);
      assert.throws(
        () => findAvailableDashboardPort("cursor", 18789, "", (p) => allBound.has(p)),
        /18789 → non-OpenShell host listener[\s\S]*18799 → non-OpenShell host listener/,
      );
    });

    it("probes each port at most once even when the preferred port is in the range", () => {
      // Avoid re-probing the same port via the proactive lsof + sudo lsof +
      // Node bind chain — those are subprocess-spawning probes and the call
      // count matters.
      const calls: number[] = [];
      const stub = (p: number) => {
        calls.push(p);
        return false;
      };
      findAvailableDashboardPort("cursor", 18789, "", stub);
      assert.equal(calls.length, 1, `expected 1 probe call, got ${calls.length}`);
      assert.equal(calls[0], 18789);
    });
  });

  it("formatOnboardConfigSummary renders all collected fields (#2165)", () => {
    const summary = formatOnboardConfigSummary({
      provider: "gemini-api",
      model: "gemini-2.5-flash",
      credentialEnv: "GEMINI_API_KEY",
      webSearchConfig: { fetchEnabled: true },
      enabledChannels: ["telegram", "slack"],
      sandboxName: "my-assistant",
      notes: ["Sandbox build typically takes 5–15 minutes on this host."],
    });

    assert.ok(summary.includes("Review configuration"), "summary has review heading");
    assert.ok(summary.includes("gemini-api"), "summary includes provider");
    assert.ok(summary.includes("gemini-2.5-flash"), "summary includes model");
    assert.ok(
      summary.includes("GEMINI_API_KEY (staged for OpenShell gateway registration)"),
      "summary shows API key env var + staging state",
    );
    assert.ok(summary.includes("enabled"), "summary includes web-search enabled");
    assert.ok(summary.includes("telegram, slack"), "summary lists enabled channels");
    assert.ok(summary.includes("my-assistant"), "summary shows sandbox name");
    assert.ok(
      summary.includes("Note:          Sandbox build typically takes 5–15 minutes on this host."),
      "summary renders notes under sandbox name",
    );

    // No messaging, no web search → "none" / "disabled"
    const bareSummary = formatOnboardConfigSummary({
      provider: "nvidia-prod",
      model: "nvidia/nemotron-3-super-120b-a12b",
      credentialEnv: "NVIDIA_API_KEY",
      webSearchConfig: null,
      enabledChannels: [],
      sandboxName: "test",
    });
    assert.ok(bareSummary.includes("Messaging:     none"), "empty channels renders as 'none'");
    assert.ok(
      bareSummary.includes("Web search:    disabled"),
      "null webSearch renders as 'disabled'",
    );

    // No credentialEnv → "(not required for <provider>)" placeholder
    const localSummary = formatOnboardConfigSummary({
      provider: "ollama-local",
      model: "llama3:8b",
      credentialEnv: null,
      webSearchConfig: null,
      enabledChannels: [],
      sandboxName: "local",
    });
    assert.ok(
      localSummary.includes("(not required for ollama-local)"),
      "null credentialEnv falls back to a provider-specific message",
    );

    // Missing provider/model → "(unset)" placeholder, not "undefined"
    const orphanSummary = formatOnboardConfigSummary({
      provider: null,
      model: null,
      webSearchConfig: null,
      enabledChannels: null,
      sandboxName: "orphan",
    });
    assert.ok(!orphanSummary.includes("undefined"), "null fields never render as 'undefined'");
    assert.ok(orphanSummary.includes("(unset)"), "null fields fall back to '(unset)'");
  });

  it("formatSandboxBuildEstimateNote warns when runtime is under-provisioned (#2514)", () => {
    const note = formatSandboxBuildEstimateNote({
      isContainerRuntimeUnderProvisioned: true,
      dockerCpus: 2,
      dockerMemTotalBytes: 2 * 1024 ** 3,
    });
    assert.ok(note != null && note.length > 0, "returns a note");
    assert.match(note as string, /under-provisioned/i, "note flags under-provisioned host");
  });

  it("formatSandboxBuildEstimateNote returns a tighter range on a generous host (#2514)", () => {
    const note = formatSandboxBuildEstimateNote({
      isContainerRuntimeUnderProvisioned: false,
      dockerCpus: 12,
      dockerMemTotalBytes: 32 * 1024 ** 3,
    });
    assert.ok(note != null, "returns a note");
    assert.match(note ?? "", /\b3[–-]\d+\s+minutes\b/, "tight range starts at 3 minutes");
  });

  it("formatSandboxBuildEstimateNote returns null when no runtime resource signal is available (#2514)", () => {
    const note = formatSandboxBuildEstimateNote({
      isContainerRuntimeUnderProvisioned: false,
    });
    assert.strictEqual(note, null);
  });
});
