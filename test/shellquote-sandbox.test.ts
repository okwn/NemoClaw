// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Verify sandbox names stay validated and out of raw shell command strings.
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";
import { describe, it, expect } from "vitest";

describe("sandboxName command hardening in onboard.js", () => {
  it("re-validates sandboxName before runner commands at the createSandbox boundary", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-invalid-sandbox-"));
    const scriptPath = path.join(tmpDir, "invalid-sandbox-name.mjs");
    const onboardUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "onboard.js")).href,
    );
    const runnerUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "runner.js")).href,
    );

    fs.writeFileSync(
      scriptPath,
      `
const runner = (await import(${runnerUrl})).default;
const commands = [];
runner.run = (command, opts = {}) => { commands.push({ type: "run", command, opts }); return { status: 0 }; };
runner.runCapture = (command, opts = {}) => { commands.push({ type: "runCapture", command, opts }); return ""; };
runner.runFile = (file, args = [], opts = {}) => { commands.push({ type: "runFile", file, args, opts }); return { status: 0 }; };
const { createSandbox } = await import(${onboardUrl});
try {
  await createSandbox(null, "test-model", "nvidia-prod", null, "bad; touch /tmp/pwned");
  console.log(JSON.stringify({ message: "unexpected success", commands }));
  process.exit(2);
} catch (error) {
  console.log(JSON.stringify({ message: error && error.message ? error.message : String(error), commands }));
}
`,
      { mode: 0o700 },
    );

    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: { HOME: tmpDir, PATH: process.env.PATH || "" },
        timeout: 5000,
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      const payloadLine = result.stdout
        .trim()
        .split("\n")
        .reverse()
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      expect(payloadLine).toBeTruthy();
      const payload = JSON.parse(payloadLine!) as { message: string; commands: unknown[] };
      expect(payload.message).toMatch(/Invalid sandbox name/);
      expect(payload.commands).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs setup-dns-proxy.sh through the argv helper instead of bash -c interpolation", () => {
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-dns-argv-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "create-sandbox-dns-argv.mjs");
    const onboardUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "onboard.js")).href,
    );
    const runnerUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "runner.js")).href,
    );
    const registryUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "registry.js")).href,
    );
    const preflightUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "preflight.js")).href,
    );
    const credentialsUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "credentials.js")).href,
    );
    const streamUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "sandbox-create-stream.js")).href,
    );

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });
    fs.writeFileSync(
      scriptPath,
      String.raw`
const runner = (await import(${runnerUrl})).default;
const registry = (await import(${registryUrl})).default;
const preflight = (await import(${preflightUrl})).default;
const credentials = (await import(${credentialsUrl})).default;
const sandboxCreateStream = (await import(${streamUrl})).default;
for (const key of Object.keys(process.env)) {
  if (/^(NEMOCLAW|OPENSHELL)_/.test(key) || key === "CHAT_UI_URL") {
    delete process.env[key];
  }
}
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
  if (text.includes("sandbox exec -n my-assistant -- curl -sf")) return "ok";
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
const { createSandbox } = await import(${onboardUrl});
try {
  process.env.OPENSHELL_GATEWAY = "nemoclaw";
  process.env.NEMOCLAW_NON_INTERACTIVE = "1";
  process.env.NEMOCLAW_HEALTH_POLL_COUNT = "1";
  const sandboxName = await createSandbox(null, "gpt-5.4", "nvidia-prod", null, "my-assistant");
  console.log(JSON.stringify({ sandboxName, commands }));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
`,
    );

    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: { HOME: tmpDir, PATH: `${fakeBin}:${process.env.PATH || ""}` },
        timeout: 30_000,
      });
      expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
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
    const repoRoot = path.join(import.meta.dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-openshell-forward-"));
    const scriptPath = path.join(tmpDir, "run-capture-openshell.mjs");
    const runnerUrl = JSON.stringify(
      pathToFileURL(path.join(repoRoot, "dist", "lib", "runner.js")).href,
    );
    const onboardUrl = JSON.stringify(
      `${pathToFileURL(path.join(repoRoot, "dist", "lib", "onboard.js")).href}?stub=${Date.now()}`,
    );

    fs.writeFileSync(
      scriptPath,
      `
const runner = (await import(${runnerUrl})).default;
let captured = null;
runner.runCapture = (command, opts = {}) => {
  captured = { command, opts };
  return "";
};
const { runCaptureOpenshell } = await import(${onboardUrl});
runCaptureOpenshell(["--version"], {
  openshellBinary: "/tmp/custom-openshell",
  ignoreError: true,
});
console.log(JSON.stringify(captured));
`,
      { mode: 0o700 },
    );

    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: { HOME: tmpDir, PATH: process.env.PATH || "" },
        timeout: 5000,
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      const capturedRun = JSON.parse(result.stdout.trim()) as {
        command: string[];
        opts: { ignoreError?: boolean };
      };
      expect(capturedRun.command).toEqual(["/tmp/custom-openshell", "--version"]);
      expect(capturedRun.opts.ignoreError).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
