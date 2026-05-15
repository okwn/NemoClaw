// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function runCommonJsShim(path, { main = false, required = {} } = {}) {
  const filename = resolve(path);
  const code = readFileSync(filename, "utf-8");
  const module = { exports: {} };
  const fakeRequire = (id) => required[id] ?? require(id);
  fakeRequire.main = main ? module : { exports: {} };
  const sandbox = {
    console,
    module,
    exports: module.exports,
    process: { ...process, env: { ...process.env }, exit: () => undefined },
    require: fakeRequire,
  };
  vm.runInNewContext(code, sandbox, { filename });
  return { module, sandbox };
}

describe("CommonJS bin compatibility shims", () => {
  it("re-export agent helper modules", () => {
    expect(require("../bin/lib/agent-defs.js").resolveAgentName).toBeTypeOf("function");
    expect(require("../bin/lib/agent-onboard.js").resolveAgent).toBeTypeOf("function");
    expect(require("../bin/lib/agent-runtime.js").getAgentDisplayName).toBeTypeOf("function");
  });

  it("re-export CLI helper modules", () => {
    expect(require("../bin/lib/ports.js").DASHBOARD_PORT).toBeTypeOf("number");
    expect(require("../bin/lib/tiers.js").listTiers).toBeTypeOf("function");
    expect(require("../bin/lib/usage-notice.js").cli).toBeTypeOf("function");
  });

  it("keeps credential path constants as live getters", () => {
    const credentials = require("../bin/lib/credentials.js");
    expect(credentials.getCredsDir).toBeTypeOf("function");
    expect(Object.getOwnPropertyDescriptor(credentials, "CREDS_DIR")?.get?.()).toBe(
      credentials.getCredsDir(),
    );
    expect(Object.getOwnPropertyDescriptor(credentials, "CREDS_FILE")?.get?.()).toBe(
      credentials.getCredsFile(),
    );
  });

  it("sets Hermes alias environment before loading the shared launcher", () => {
    const { module, sandbox } = runCommonJsShim("bin/nemohermes.js", {
      required: { "../dist/nemoclaw": { loaded: true } },
    });
    expect(sandbox.process.env.NEMOCLAW_AGENT).toBe("hermes");
    expect(sandbox.process.env.NEMOCLAW_INVOKED_AS).toBe("nemohermes");
    expect(module.exports).toEqual({ loaded: true });
  });

  it("loads the shared launcher from the nemoclaw binary", () => {
    const { module } = runCommonJsShim("bin/nemoclaw.js", {
      required: { "../dist/nemoclaw": { loaded: true } },
    });
    expect(module.exports).toEqual({});
  });

  it("runs usage notice CLI when invoked as the main module", async () => {
    let called = false;
    runCommonJsShim("bin/lib/usage-notice.js", {
      main: true,
      required: {
        "../../dist/lib/onboard/usage-notice": {
          cli: async () => {
            called = true;
          },
        },
      },
    });
    await Promise.resolve();
    expect(called).toBe(true);
  });

  it("reports usage notice CLI failures", async () => {
    const errors = [];
    const exits = [];
    const filename = resolve("bin/lib/usage-notice.js");
    const code = readFileSync(filename, "utf-8");
    const module = { exports: {} };
    const fakeRequire = (id) =>
      id === "../../dist/lib/onboard/usage-notice"
        ? {
            cli: async () => {
              throw new Error("boom");
            },
          }
        : require(id);
    fakeRequire.main = module;
    vm.runInNewContext(
      code,
      {
        console: { ...console, error: (message) => errors.push(message) },
        module,
        exports: module.exports,
        process: { ...process, env: { ...process.env }, exit: (code) => exits.push(code) },
        require: fakeRequire,
      },
      { filename },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(["boom"]);
    expect(exits).toEqual([1]);
  });
});
