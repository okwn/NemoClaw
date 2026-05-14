// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.join(import.meta.dirname, "..");
const SHIM_SCRIPT = path.join(REPO_ROOT, "nemoclaw-blueprint", "scripts", "openclaw-rcf-shim.js");

interface ShimRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runHarness(harness: string, env: NodeJS.ProcessEnv): ShimRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-rcf-shim-"));
  const harnessFile = path.join(dir, "harness.js");
  fs.writeFileSync(harnessFile, harness);
  try {
    const result = spawnSync(
      process.execPath,
      ["--require", SHIM_SCRIPT, harnessFile],
      {
        encoding: "utf-8",
        env: { ...process.env, ...env },
        timeout: 5000,
      },
    );
    return {
      exitCode: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const fakeMutateHarness = (mutatePath: string, callBody: string) => `
"use strict";
const Module = require("node:module");
const path = require("node:path");

const fakePath = ${JSON.stringify(mutatePath)};
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "openclaw-mutate-fake") return fakePath;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const Mod = new Module(fakePath, null);
Mod.filename = fakePath;
Mod.paths = Module._nodeModulePaths(path.dirname(fakePath));

Mod.exports = {
  replaceConfigFile: async function (params) {
    ${callBody}
  },
};
Mod.loaded = true;
Module._cache[fakePath] = Mod;

(async () => {
  const mod = require("openclaw-mutate-fake");
  try {
    const result = await mod.replaceConfigFile({
      nextConfig: { foo: 1 },
      snapshot: { path: "/sandbox/.openclaw/openclaw.json" },
    });
    process.stdout.write(JSON.stringify({ ok: true, result }) + "\\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, code: err && err.code, message: err && err.message }) + "\\n");
  }
})();
`;

describe("openclaw-rcf-shim runtime trap", () => {
  it("does nothing outside the OpenShell sandbox", () => {
    const fakeMutate = "/tmp/openclaw/dist/config/mutate.js";
    const run = runHarness(
      fakeMutateHarness(fakeMutate, "const err = new Error('readonly'); err.code = 'EACCES'; throw err;"),
      {
        OPENSHELL_SANDBOX: "",
        OPENCLAW_VERSION: "2026.4.24",
        NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM: "9999.99.99",
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toContain('"code":"EACCES"');
  });

  it("swallows EACCES inside the sandbox and returns a synthesised ConfigReplaceResult", () => {
    const fakeMutate = "/tmp/openclaw/dist/config/mutate.js";
    const run = runHarness(
      fakeMutateHarness(fakeMutate, "const err = new Error('readonly'); err.code = 'EACCES'; throw err;"),
      {
        OPENSHELL_SANDBOX: "1",
        OPENCLAW_VERSION: "2026.4.24",
        NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM: "9999.99.99",
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain("Config is read-only in sandbox");
    const payload = JSON.parse(run.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.result.path).toBe("/sandbox/.openclaw/openclaw.json");
    expect(payload.result.afterWrite).toBe("noop");
    expect(payload.result.nextConfig).toEqual({ foo: 1 });
  });

  it("re-throws non-EACCES errors even when the shim is active", () => {
    const fakeMutate = "/tmp/openclaw/dist/config/mutate.js";
    const run = runHarness(
      fakeMutateHarness(fakeMutate, "const err = new Error('boom'); err.code = 'EOTHER'; throw err;"),
      {
        OPENSHELL_SANDBOX: "1",
        OPENCLAW_VERSION: "2026.4.24",
        NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM: "9999.99.99",
      },
    );
    expect(run.exitCode).toBe(0);
    const payload = JSON.parse(run.stdout.trim());
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("EOTHER");
  });

  it("passes the original return value through when no error is raised", () => {
    const fakeMutate = "/tmp/openclaw/dist/config/mutate.js";
    const run = runHarness(
      fakeMutateHarness(
        fakeMutate,
        "return { path: params.snapshot.path, previousHash: 'abc', snapshot: params.snapshot, nextConfig: params.nextConfig, afterWrite: 'fsync', followUp: null };",
      ),
      {
        OPENSHELL_SANDBOX: "1",
        OPENCLAW_VERSION: "2026.4.24",
        NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM: "9999.99.99",
      },
    );
    expect(run.exitCode).toBe(0);
    const payload = JSON.parse(run.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.result.previousHash).toBe("abc");
    expect(payload.result.afterWrite).toBe("fsync");
  });

  it("skips wrapping when OPENCLAW_VERSION is past the sentinel", () => {
    const fakeMutate = "/tmp/openclaw/dist/config/mutate.js";
    const run = runHarness(
      fakeMutateHarness(fakeMutate, "const err = new Error('readonly'); err.code = 'EACCES'; throw err;"),
      {
        OPENSHELL_SANDBOX: "1",
        OPENCLAW_VERSION: "2026.6.1",
        NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM: "2026.5.41",
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.stderr).not.toContain("Config is read-only");
    const payload = JSON.parse(run.stdout.trim());
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("EACCES");
  });

  it("stays inactive when the module's filename does not match the openclaw mutate path", () => {
    const fakeMutate = "/tmp/unrelated/dist/other.js";
    const run = runHarness(
      fakeMutateHarness(fakeMutate, "const err = new Error('readonly'); err.code = 'EACCES'; throw err;"),
      {
        OPENSHELL_SANDBOX: "1",
        OPENCLAW_VERSION: "2026.4.24",
        NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM: "9999.99.99",
      },
    );
    expect(run.exitCode).toBe(0);
    const payload = JSON.parse(run.stdout.trim());
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("EACCES");
  });
});
