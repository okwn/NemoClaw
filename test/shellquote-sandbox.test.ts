// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Verify sandbox names stay validated and out of raw shell command strings.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);

describe("sandboxName command hardening in onboard.js", () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "lib", "onboard.ts"),
    "utf-8",
  );

  it("re-validates sandboxName at the createSandbox boundary", async () => {
    const { createSandbox } = require("../dist/lib/onboard.js") as {
      createSandbox: (
        gpu: null,
        model: string,
        provider: string,
        preferredInferenceApi: null,
        sandboxNameOverride: string,
      ) => Promise<string>;
    };

    await expect(
      createSandbox(null, "test-model", "nvidia-prod", null, "bad; touch /tmp/pwned"),
    ).rejects.toThrow(/Invalid sandbox name/);
  });

  it("runs setup-dns-proxy.sh through the argv helper instead of bash -c interpolation", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-dns-argv-"));
    const scriptPath = path.join(tmpDir, "create-sandbox-dns-argv.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "registry.js"));
    const preflightPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "preflight.js"));
    const credentialsPath = JSON.stringify(path.join(repoRoot, "dist", "lib", "credentials.js"));
    const streamPath = JSON.stringify(
      path.join(repoRoot, "dist", "lib", "sandbox-create-stream.js"),
    );

    fs.writeFileSync(
      scriptPath,
      String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});
const preflight = require(${preflightPath});
const credentials = require(${credentialsPath});
const sandboxCreateStream = require(${streamPath});
const commands = [];
const asText = (command) => Array.isArray(command) ? command.join(" ") : String(command);
runner.run = (command, opts = {}) => {
  commands.push({ type: "run", command: asText(command), env: opts.env || null });
  return { status: 0 };
};
runner.runFile = (file, args = [], opts = {}) => {
  commands.push({ type: "runFile", file, args, command: asText([file, ...args]), env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  const text = asText(command);
  if (text.includes("sandbox get my-assistant")) return "";
  if (text.includes("sandbox list")) return "my-assistant Ready";
  if (text.includes("forward list")) return "";
  if (text.includes("sandbox exec my-assistant curl -sf")) return "ok";
  if (text === "uname -r") return "6.8.0";
  return "";
};
registry.getSandbox = () => null;
registry.getDisabledChannels = () => [];
registry.registerSandbox = () => true;
registry.removeSandbox = () => true;
registry.updateSandbox = () => true;
preflight.checkPortAvailable = async () => ({ ok: true });
credentials.prompt = async () => "";
sandboxCreateStream.streamSandboxCreate = async () => ({
  status: 0,
  output: "Built image openshell/sandbox-from:123\nCreated sandbox: my-assistant",
  sawProgress: true,
});
const { createSandbox } = require(${onboardPath});
(async () => {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  process.env.NEMOCLAW_NON_INTERACTIVE = "1";
  process.env.NEMOCLAW_HEALTH_POLL_COUNT = "1";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`,
    );

    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: { ...process.env, HOME: tmpDir },
        timeout: 30_000,
      });
      expect(result.status).toBe(0);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      expect(payloadLine).toBeTruthy();
      const payload = JSON.parse(payloadLine!);
      const dnsCommand = payload.commands.find(
        (entry: { type: string; args: string[] }) =>
          entry.type === "runFile" && entry.args[0]?.endsWith("setup-dns-proxy.sh"),
      );
      expect(dnsCommand).toBeTruthy();
      expect(dnsCommand.file).toBe("bash");
      expect(dnsCommand.args).toEqual([
        expect.stringMatching(/setup-dns-proxy\.sh$/),
        "nemoclaw",
        "my-assistant",
      ]);
      expect(dnsCommand.command).not.toContain("bash -c");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("forwards opts to openshellArgv so openshellBinary overrides are not dropped", () => {
    const runnerPath = require.resolve("../dist/lib/runner.js");
    const onboardPath = require.resolve("../dist/lib/onboard.js");
    const runner = require(runnerPath);
    const originalRunCapture = runner.runCapture;
    let captured: { command: string[]; opts: { ignoreError?: boolean } } | null = null;

    runner.runCapture = (command: string[], opts: { ignoreError?: boolean } = {}) => {
      captured = { command, opts };
      return "";
    };
    delete require.cache[onboardPath];
    try {
      const { runCaptureOpenshell } = require(onboardPath) as {
        runCaptureOpenshell: (
          args: string[],
          opts: { openshellBinary?: string; ignoreError?: boolean },
        ) => string;
      };
      runCaptureOpenshell(["--version"], {
        openshellBinary: "/tmp/custom-openshell",
        ignoreError: true,
      });

      expect(captured).not.toBeNull();
      const capturedRun = captured as unknown as {
        command: string[];
        opts: { ignoreError?: boolean };
      };
      expect(capturedRun.command).toEqual(["/tmp/custom-openshell", "--version"]);
      expect(capturedRun.opts.ignoreError).toBe(true);
    } finally {
      runner.runCapture = originalRunCapture;
      delete require.cache[onboardPath];
    }
  });

  it("does not have raw sandboxName interpolation in run or runCapture template literals", () => {
    // Match run()/runCapture() calls that span multiple lines and contain
    // template literals, so multiline invocations are not missed.
    const callPattern = /\b(run|runCapture)\s*\(\s*`([^`]*)`/g;
    const violations = [];
    let match;
    while ((match = callPattern.exec(src)) !== null) {
      const template = match[2];
      if (template.includes("${sandboxName}") && !template.includes("shellQuote(sandboxName)")) {
        const line = src.slice(0, match.index).split("\n").length;
        violations.push(`Line ${line}: ${match[0].slice(0, 120).trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
