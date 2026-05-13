// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { DASHBOARD_PORT, DASHBOARD_PORT_RANGE_END, DASHBOARD_PORT_RANGE_START } from "../core/ports";

export type ForwardEntry = {
  sandboxName: string;
  status: string;
};

type RunOptions = {
  ignoreError?: boolean;
  stdio?: any;
};

type RunResult = {
  status: number | null;
};

export type DashboardForwardDeps = {
  getDashboardForwardPort: (chatUiUrl?: string) => string;
  getDashboardForwardTarget: (chatUiUrl?: string) => string;
  runCapture: (args: string[], options: { ignoreError: true }) => string;
  runCaptureOpenshell: (args: string[], options: { ignoreError: true }) => string;
  runOpenshell: (args: string[], options: RunOptions) => RunResult;
  cliName: () => string;
  warn?: (message?: string) => void;
  error?: (message?: string) => void;
  exitProcess?: (code: number) => never;
};

const CONTROL_UI_PORT = DASHBOARD_PORT;
const ANSI_RE = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-_])/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}


// Parses `openshell forward list` output and returns the sandbox currently
// owning `portToStop`, or null. Exported for unit testing — see #2169.
// Columns: SANDBOX  BIND  PORT  PID  STATUS (whitespace-separated).
export function findDashboardForwardOwner(
  forwardListOutput: string | null | undefined,
  portToStop: string,
): string | null {
  if (!forwardListOutput) return null;
  const portLine = forwardListOutput
    .split("\n")
    .map((l) => l.trim())
    .find((l) => {
      const parts = l.split(/\s+/);
      return parts[2] === portToStop;
    });
  return portLine ? (portLine.split(/\s+/)[0] ?? null) : null;
}

export function findForwardEntry(
  forwardListOutput: string | null | undefined,
  port: string,
): ForwardEntry | null {
  if (!forwardListOutput) return null;
  for (const rawLine of forwardListOutput.split("\n")) {
    const line = stripAnsi(rawLine);
    if (/^\s*SANDBOX\s/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || parts[2] !== port) continue;
    return {
      sandboxName: parts[0] || "",
      status: (parts[4] || "").toLowerCase(),
    };
  }
  return null;
}

export function isLiveForwardStatus(status: string): boolean {
  return status === "running" || status === "active";
}

export function getRunningForwardPorts(forwardListOutput: string | null | undefined): string[] {
  const ports = new Set<string>();
  if (!forwardListOutput) return [];
  for (const rawLine of forwardListOutput.split("\n")) {
    const line = stripAnsi(rawLine);
    if (/^\s*SANDBOX\s/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !/^\d+$/.test(parts[2])) continue;
    const status = (parts[4] || "").toLowerCase();
    if (isLiveForwardStatus(status)) {
      ports.add(parts[2]);
    }
  }
  return [...ports];
}

/**
 * Parse `openshell forward list` output into a Map<port, sandboxName>.
 * Only includes running forwards — stopped/stale entries are ignored so
 * they don't block port allocation or cause false "range exhausted" errors.
 */
export function getOccupiedPorts(forwardListOutput: string | null): Map<string, string> {
  const occupied = new Map<string, string>();
  if (!forwardListOutput) return occupied;
  for (const rawLine of forwardListOutput.split("\n")) {
    const line = stripAnsi(rawLine);
    if (/^\s*SANDBOX\s/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !/^\d+$/.test(parts[2])) continue;
    const status = (parts[4] || "").toLowerCase();
    if (!isLiveForwardStatus(status)) continue;
    occupied.set(parts[2], parts[0]);
  }
  return occupied;
}

/**
 * Build the actionable error lines printed when the just-created openshell
 * sandbox is rolled back after a dashboard port-allocation failure. Pure
 * function over (sandboxName, alloc-error, delete-result) so the rollback path
 * is testable without spawning subprocesses or exiting the process (#2174).
 */
export function buildOrphanedSandboxRollbackMessage(
  sandboxName: string,
  err: unknown,
  deleteSucceeded: boolean,
): string[] {
  const lines = [
    "",
    `  Could not allocate a dashboard port for '${sandboxName}'.`,
    `  ${err instanceof Error ? err.message : String(err)}`,
  ];
  if (deleteSucceeded) {
    lines.push("  The orphaned sandbox has been removed — you can safely retry.");
  } else {
    lines.push("  Could not remove the orphaned sandbox. Manual cleanup:");
    lines.push(`    openshell sandbox delete "${sandboxName}"`);
  }
  return lines;
}

export function createDashboardForwardHelpers(deps: DashboardForwardDeps) {
  const warn = deps.warn ?? console.warn;
  const error = deps.error ?? console.error;
  const exitProcess = deps.exitProcess ?? ((code: number): never => process.exit(code));

  function stopAllDashboardForwards(): void {
    const forwardList = deps.runCaptureOpenshell(["forward", "list"], { ignoreError: true });
    for (const port of getRunningForwardPorts(forwardList)) {
      deps.runOpenshell(["forward", "stop", port], { ignoreError: true });
    }
  }

  /** Quick synchronous check whether a TCP port has an active listener on the host. */
  function isPortBoundOnHost(port: number): boolean {
    try {
      const out = deps.runCapture(["lsof", "-i", `:${port}`, "-sTCP:LISTEN", "-P", "-n"], {
        ignoreError: true,
      });
      return !!out && out.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Find the next available dashboard port for the given sandbox. */
  function findAvailableDashboardPort(
    sandboxName: string,
    preferredPort: number,
    forwardListOutput: string | null,
  ): number {
    const occupied = getOccupiedPorts(forwardListOutput);
    const preferredStr = String(preferredPort);
    const owner = occupied.get(preferredStr) ?? null;
    if (owner === sandboxName) return preferredPort;
    if (owner === null && !isPortBoundOnHost(preferredPort)) return preferredPort;

    for (let p = DASHBOARD_PORT_RANGE_START; p <= DASHBOARD_PORT_RANGE_END; p++) {
      const pStr = String(p);
      const pOwner = occupied.get(pStr) ?? null;
      if (pOwner === sandboxName) return p;
      if (pOwner === null && !isPortBoundOnHost(p)) return p;
    }

    const owners = [...occupied.entries()]
      .filter(
        ([p]) => Number(p) >= DASHBOARD_PORT_RANGE_START && Number(p) <= DASHBOARD_PORT_RANGE_END,
      )
      .map(([p, s]) => `  ${p} → ${s}`)
      .join("\n");
    throw new Error(
      `All dashboard ports in range ${DASHBOARD_PORT_RANGE_START}-${DASHBOARD_PORT_RANGE_END} are occupied:\n${owners}\n` +
        "Free a sandbox or use --control-ui-port <N> with a port outside this range.",
    );
  }

  function ensureDashboardForward(
    sandboxName: string,
    chatUiUrl = `http://127.0.0.1:${CONTROL_UI_PORT}`,
    options: { rollbackSandboxOnFailure?: boolean } = {},
  ): number {
    const { rollbackSandboxOnFailure = false } = options;
    const preferredPort = Number(deps.getDashboardForwardPort(chatUiUrl));
    let existingForwards = deps.runCaptureOpenshell(["forward", "list"], { ignoreError: true });
    const preferredEntry = findForwardEntry(existingForwards, String(preferredPort));
    if (
      preferredEntry &&
      (preferredEntry.sandboxName === sandboxName || !isLiveForwardStatus(preferredEntry.status))
    ) {
      deps.runOpenshell(["forward", "stop", String(preferredPort)], { ignoreError: true });
      existingForwards = deps.runCaptureOpenshell(["forward", "list"], { ignoreError: true });
    }
    let actualPort: number;
    try {
      actualPort = findAvailableDashboardPort(sandboxName, preferredPort, existingForwards);
    } catch (err) {
      if (!rollbackSandboxOnFailure) throw err;
      const delResult = deps.runOpenshell(["sandbox", "delete", sandboxName], { ignoreError: true });
      for (const line of buildOrphanedSandboxRollbackMessage(
        sandboxName,
        err,
        delResult.status === 0,
      )) {
        error(line);
      }
      exitProcess(1);
      throw err;
    }

    if (actualPort !== preferredPort) {
      warn(`  ! Port ${preferredPort} is taken. Using port ${actualPort} instead.`);
    }

    const occupied = getOccupiedPorts(existingForwards);
    for (const [port, owner] of occupied.entries()) {
      if (owner === sandboxName && Number(port) !== actualPort) {
        deps.runOpenshell(["forward", "stop", port], { ignoreError: true });
      }
    }

    const parsedUrl = new URL(chatUiUrl.includes("://") ? chatUiUrl : `http://${chatUiUrl}`);
    parsedUrl.port = String(actualPort);
    const actualTarget = deps.getDashboardForwardTarget(parsedUrl.toString());
    deps.runOpenshell(["forward", "stop", String(actualPort)], { ignoreError: true });
    const fwdResult = deps.runOpenshell(
      ["forward", "start", "--background", actualTarget, sandboxName],
      {
        ignoreError: true,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    if (fwdResult && fwdResult.status !== 0) {
      warn(`! Port ${actualPort} forward did not start — port may be in use by another process.`);
      warn(`  Check: docker ps --format 'table {{.Names}}\\t{{.Ports}}' | grep ${actualPort}`);
      warn(`  Free the port, then reconnect: ${deps.cliName()} ${sandboxName} connect`);
    }
    return actualPort;
  }

  function ensureAgentDashboardForward(
    sandboxName: string,
    agent: { forwardPort?: number | null },
  ): number {
    const agentDashboardPort = agent.forwardPort ?? CONTROL_UI_PORT;
    const agentDashboardUrl = `http://127.0.0.1:${agentDashboardPort}`;
    const actualAgentDashboardPort = ensureDashboardForward(sandboxName, agentDashboardUrl);
    process.env.CHAT_UI_URL = `http://127.0.0.1:${actualAgentDashboardPort}`;
    return actualAgentDashboardPort;
  }

  return {
    stopAllDashboardForwards,
    isPortBoundOnHost,
    findAvailableDashboardPort,
    ensureDashboardForward,
    ensureAgentDashboardForward,
  };
}
