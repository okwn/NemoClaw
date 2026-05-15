// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { sleepMs, sleepSeconds, waitForHttp, waitForPort, waitUntil } from "../../../dist/lib/core/wait";

const originalPath = process.env.PATH;
const tempDirs: string[] = [];

afterEach(() => {
  process.env.PATH = originalPath;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function installFakeCommand(name: string, body = "exit 0\n"): void {
  const dir = mkdtempSync(join(tmpdir(), "nemoclaw-wait-bin-"));
  tempDirs.push(dir);
  const commandPath = join(dir, name);
  writeFileSync(commandPath, `#!/bin/sh\n${body}`);
  chmodSync(commandPath, 0o755);
  process.env.PATH = `${dir}:${originalPath ?? ""}`;
}

describe("core wait helpers", () => {
  it("handles sleep bounds", () => {
    expect(() => sleepMs(0)).not.toThrow();
    expect(() => sleepMs(Number.NaN)).not.toThrow();
    expect(() => sleepMs(1)).not.toThrow();
    expect(() => sleepSeconds(0)).not.toThrow();
  });

  it("returns immediately when the wait condition succeeds", () => {
    let calls = 0;
    expect(
      waitUntil(() => {
        calls += 1;
        return true;
      }),
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("returns false when the timeout elapses before polling", () => {
    expect(waitUntil(() => true, 0, 1)).toBe(false);
  });

  it("can poll before the wait condition succeeds", () => {
    let calls = 0;
    expect(
      waitUntil(() => {
        calls += 1;
        return calls > 1;
      }, 1, 0),
    ).toBe(true);
    expect(calls).toBe(2);
  });

  it("detects a reachable port using nc", () => {
    installFakeCommand("nc");
    expect(waitForPort(12345, 1)).toBe(true);
  });

  it("returns false when nc never reports a reachable port", () => {
    installFakeCommand("nc", "exit 1\n");
    expect(waitForPort(12345, 0.001)).toBe(false);
  });

  it("detects a healthy HTTP endpoint using curl", () => {
    installFakeCommand("curl");
    expect(waitForHttp("http://127.0.0.1:18789/health", 1)).toBe(true);
  });

  it("returns false when curl never reports a healthy endpoint", () => {
    installFakeCommand("curl", "exit 1\n");
    expect(waitForHttp("http://127.0.0.1:18789/health", 0.001)).toBe(false);
  });
});
