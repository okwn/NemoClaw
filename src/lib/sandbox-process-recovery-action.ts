// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/* v8 ignore start -- exercised through CLI subprocess connect/status/rebuild tests. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { DASHBOARD_PORT } from "./ports";
import { ROOT, shellQuote } from "./runner";
import {
  captureOpenshell,
  captureOpenshellForStatus,
  getOpenshellBinary,
  isCommandTimeout,
  runOpenshell,
} from "./adapters/openshell/runtime";
import { OPENSHELL_PROBE_TIMEOUT_MS } from "./adapters/openshell/timeouts";
import { G, R } from "./terminal-style";
import { sleepSeconds } from "./wait";

const agentRuntime = require("../../bin/lib/agent-runtime");

export type SandboxCommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

const SANDBOX_EXEC_STARTED_MARKER = "__NEMOCLAW_SANDBOX_EXEC_STARTED__";
const DASHBOARD_FORWARD_PORT = String(DASHBOARD_PORT);

/**
 * Run a command inside the sandbox via SSH and return { status, stdout, stderr }.
 * Returns null if SSH config cannot be obtained.
 */
export function executeSandboxCommand(
  sandboxName: string,
  command: string,
): SandboxCommandResult | null {
  const sshConfigResult = captureOpenshell(["sandbox", "ssh-config", sandboxName], {
    ignoreError: true,
    timeout: OPENSHELL_PROBE_TIMEOUT_MS,
  });
  if (sshConfigResult.status !== 0) return null;
  if (!sshConfigResult.output.trim()) return null;

  const tmpFile = path.join(os.tmpdir(), `nemoclaw-ssh-${process.pid}-${Date.now()}.conf`);
  fs.writeFileSync(tmpFile, sshConfigResult.output, { mode: 0o600 });
  try {
    const result = spawnSync(
      "ssh",
      [
        "-F",
        tmpFile,
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "LogLevel=ERROR",
        `openshell-${sandboxName}`,
        command,
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
    );
    return {
      status: result.status ?? 1,
      stdout: (result.stdout || "").trim(),
      stderr: (result.stderr || "").trim(),
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

export function executeSandboxExecCommand(
  sandboxName: string,
  command: string,
  timeout = 15000,
): SandboxCommandResult | null {
  const markedCommand = `printf '%s\n' '${SANDBOX_EXEC_STARTED_MARKER}'; ${command}`;
  try {
    const timeoutOverride = Number(process.env.NEMOCLAW_SANDBOX_EXEC_TIMEOUT_MS || "");
    const effectiveTimeout =
      Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : timeout;
    const result = spawnSync(
      getOpenshellBinary(),
      ["sandbox", "exec", "--name", sandboxName, "--", "sh", "-c", markedCommand],
      {
        cwd: ROOT,
        encoding: "utf-8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: effectiveTimeout,
      },
    );
    if (result.error) return null;
    const stdout = (result.stdout || "").trim();
    const stdoutLines = stdout.split(/\r?\n/);
    const markerIndex = stdoutLines.indexOf(SANDBOX_EXEC_STARTED_MARKER);
    if (markerIndex === -1) return null;
    const commandStdoutLines = stdoutLines.slice(markerIndex + 1);
    return {
      status: result.status ?? 1,
      stdout: commandStdoutLines.join("\n").trim(),
      stderr: (result.stderr || "").trim(),
    };
  } catch {
    return null;
  }
}

async function executeSandboxExecCommandForStatus(
  sandboxName: string,
  command: string,
): Promise<SandboxCommandResult | null> {
  const markedCommand = `printf '%s\n' '${SANDBOX_EXEC_STARTED_MARKER}'; ${command}`;
  const result = await captureOpenshellForStatus(
    ["sandbox", "exec", "--name", sandboxName, "--", "sh", "-c", markedCommand],
    { ignoreError: true },
  );
  if (isCommandTimeout(result) || result.error) return null;
  const stdout = (result.output || "").trim();
  const stdoutLines = stdout.split(/\r?\n/);
  const markerIndex = stdoutLines.indexOf(SANDBOX_EXEC_STARTED_MARKER);
  if (markerIndex === -1) return null;
  const commandStdoutLines = stdoutLines.slice(markerIndex + 1);
  return {
    status: result.status ?? 1,
    stdout: commandStdoutLines.join("\n").trim(),
    stderr: "",
  };
}

function parseSandboxGatewayProbe(result: SandboxCommandResult | null): boolean | null {
  if (!result) return null;
  if (result.stdout === "RUNNING") return true;
  if (result.stdout === "STOPPED") return false;
  return null;
}

/**
 * Check whether the OpenClaw gateway process is running inside the sandbox.
 * Uses the gateway's HTTP endpoint (dashboard port) as the source of truth,
 * since the gateway runs as a separate user and pgrep may not see it.
 * Returns true (running), false (stopped), or null (cannot determine).
 */
function isSandboxGatewayRunning(sandboxName: string): boolean | null {
  const agent = agentRuntime.getSessionAgent(sandboxName);
  const probeUrl = agentRuntime.getHealthProbeUrl(agent);
  const command = `curl -sf --max-time 3 ${shellQuote(probeUrl)} > /dev/null 2>&1 && echo RUNNING || echo STOPPED`;
  const execProbe = parseSandboxGatewayProbe(executeSandboxExecCommand(sandboxName, command));
  if (execProbe !== null) return execProbe;
  return parseSandboxGatewayProbe(executeSandboxCommand(sandboxName, command));
}

export async function isSandboxGatewayRunningForStatus(
  sandboxName: string,
): Promise<boolean | null> {
  const agent = agentRuntime.getSessionAgent(sandboxName);
  const probeUrl = agentRuntime.getHealthProbeUrl(agent);
  const command = `curl -sf --max-time 3 ${shellQuote(probeUrl)} > /dev/null 2>&1 && echo RUNNING || echo STOPPED`;
  return parseSandboxGatewayProbe(await executeSandboxExecCommandForStatus(sandboxName, command));
}

/**
 * Restart the gateway process inside the sandbox after a pod restart.
 * Cleans stale lock/temp files, sources proxy config, and launches the gateway
 * in the background. Returns true on success.
 */
function recoverSandboxProcesses(sandboxName: string): boolean {
  const agent = agentRuntime.getSessionAgent(sandboxName);
  const agentScript = agentRuntime.buildRecoveryScript(agent, agent?.forwardPort ?? DASHBOARD_PORT);
  const hasRecoveryMarker = (result: SandboxCommandResult | null) =>
    !!(
      result &&
      (result.stdout.includes("GATEWAY_PID=") || result.stdout.includes("ALREADY_RUNNING"))
    );
  const recoveredSsh = (result: SandboxCommandResult | null) =>
    !!(result && result.status === 0 && hasRecoveryMarker(result));

  if (agentScript) {
    // Non-OpenClaw manifests do not yet declare a runtime user for root
    // sandbox exec. Recover them over SSH so the launch inherits the sandbox
    // login user instead of creating root-owned agent state under /sandbox.
    return recoveredSsh(executeSandboxCommand(sandboxName, agentScript));
  }

  const script = agentRuntime.buildOpenClawRecoveryScript(DASHBOARD_PORT);
  const execResult = executeSandboxExecCommand(sandboxName, script, 30000);
  if (hasRecoveryMarker(execResult)) return true;
  if (execResult !== null) return false;
  return recoveredSsh(executeSandboxCommand(sandboxName, script));
}

function readNonNegativeNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function waitForRecoveredSandboxGateway(sandboxName: string): boolean {
  const timeoutSeconds = readNonNegativeNumberEnv("NEMOCLAW_GATEWAY_RECOVERY_WAIT_SECONDS", 30);
  const intervalSeconds = readNonNegativeNumberEnv(
    "NEMOCLAW_GATEWAY_RECOVERY_POLL_INTERVAL_SECONDS",
    3,
  );
  const attempts =
    intervalSeconds > 0
      ? Math.max(1, Math.floor(timeoutSeconds / intervalSeconds) + 1)
      : Math.max(1, Math.floor(timeoutSeconds) + 1);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isSandboxGatewayRunning(sandboxName) === true) {
      return true;
    }
    if (attempt < attempts - 1) {
      sleepSeconds(intervalSeconds);
    }
  }
  return false;
}

/**
 * Re-establish the dashboard port forward to the sandbox.
 * Uses the agent's forward port when a non-OpenClaw agent is active.
 */
function ensureSandboxPortForward(sandboxName: string): void {
  const agent = agentRuntime.getSessionAgent(sandboxName);
  const port = agent ? String(agent.forwardPort) : DASHBOARD_FORWARD_PORT;
  runOpenshell(["forward", "stop", port], { ignoreError: true });
  runOpenshell(["forward", "start", "--background", port, sandboxName], {
    ignoreError: true,
  });
}

/**
 * Detect and recover from a sandbox that survived a gateway restart but
 * whose OpenClaw processes are not running. Returns an object describing
 * the outcome: { checked, wasRunning, recovered }.
 */
export function checkAndRecoverSandboxProcesses(
  sandboxName: string,
  { quiet = false }: { quiet?: boolean } = {},
) {
  const running = isSandboxGatewayRunning(sandboxName);
  if (running === null) {
    return { checked: false, wasRunning: null, recovered: false };
  }
  if (running) {
    return { checked: true, wasRunning: true, recovered: false };
  }

  // Gateway not running — attempt recovery
  const recoveryAgent = agentRuntime.getSessionAgent(sandboxName);
  if (!quiet) {
    console.log("");
    console.log(
      `  ${agentRuntime.getAgentDisplayName(recoveryAgent)} gateway is not running inside the sandbox (sandbox likely restarted).`,
    );
    console.log("  Recovering...");
  }

  const recovered = recoverSandboxProcesses(sandboxName);
  if (recovered) {
    // Wait for gateway to bind its HTTP port before declaring success. The
    // recovered process can be alive before the OpenAI-compatible API is ready.
    if (!waitForRecoveredSandboxGateway(sandboxName)) {
      if (!quiet) {
        console.error("  Gateway process started but is not responding.");
        console.error("  Check /tmp/gateway.log inside the sandbox for details.");
      }
      return { checked: true, wasRunning: false, recovered: false };
    }
    ensureSandboxPortForward(sandboxName);
    if (!quiet) {
      console.log(
        `  ${G}✓${R} ${agentRuntime.getAgentDisplayName(recoveryAgent)} gateway restarted inside sandbox.`,
      );
      console.log(`  ${G}✓${R} Dashboard port forward re-established.`);
    }
  } else if (!quiet) {
    console.error(
      `  Could not restart ${agentRuntime.getAgentDisplayName(recoveryAgent)} gateway automatically.`,
    );
    console.error("  Connect to the sandbox and run manually:");
    console.error(`    ${agentRuntime.getGatewayCommand(recoveryAgent)}`);
  }

  return { checked: true, wasRunning: false, recovered };
}
