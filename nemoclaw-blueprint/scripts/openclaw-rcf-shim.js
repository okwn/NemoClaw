// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// openclaw-rcf-shim.js — runtime trap for OpenClaw's replaceConfigFile
//
// Plugin install / config persistence in OpenClaw calls
// `replaceConfigFile(...)`, which writes to /sandbox/.openclaw/openclaw.json.
// Inside an OpenShell sandbox that path is Landlock read-only by design,
// so the write throws EACCES and the calling plugin's install path crashes.
//
// This preload hooks `Module.prototype.require` and, the first time the
// OpenClaw `mutate.js` (or equivalent) module is loaded, wraps its exported
// `replaceConfigFile` in a try/catch that swallows EACCES inside the
// sandbox and returns a plausible ConfigReplaceResult so the caller can
// continue. The plugin's intended write is silently dropped; the plugin
// code still loads via OpenClaw's auto-discovery from `extensions/`.
//
// The wrap is gated on two env vars set by `scripts/nemoclaw-start.sh`:
//   - OPENCLAW_VERSION  — the running OpenClaw version, e.g. "2026.4.24"
//   - NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM  — the highest OpenClaw version
//     known to still ship the upstream defect (openclaw/openclaw#72950).
// If OPENCLAW_VERSION is strictly greater than the sentinel, the shim
// stays out of the way on the assumption that the upstream fix has landed.
//
// Ref: NemoClaw #2686, #3497 (symptom-reports); openclaw/openclaw#72950
// (upstream).

(function () {
  "use strict";

  if (process.env.OPENSHELL_SANDBOX !== "1") return;

  function parseVersion(value) {
    if (!value) return null;
    const parts = String(value).trim().split(".");
    if (parts.length === 0) return null;
    const numbers = [];
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isFinite(n) || n < 0) return null;
      numbers.push(n);
    }
    return numbers;
  }

  function versionGreaterThan(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return false;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av > bv) return true;
      if (av < bv) return false;
    }
    return false;
  }

  const sentinel = process.env.NEMOCLAW_LAST_OPENCLAW_NEEDING_RCF_SHIM;
  const current = process.env.OPENCLAW_VERSION;
  if (versionGreaterThan(current, sentinel)) {
    return;
  }

  const Module = require("node:module");
  const origRequire = Module.prototype.require;

  const MUTATE_FILE = /\/openclaw\/.*\/mutate(?:\.js)?$/;
  let wrapped = false;

  Module.prototype.require = function patchedRequire(id) {
    const exported = origRequire.apply(this, arguments);
    if (wrapped) return exported;
    if (!exported || typeof exported !== "object") return exported;
    if (typeof exported.replaceConfigFile !== "function") return exported;

    let resolvedFilename = "";
    try {
      resolvedFilename = Module._resolveFilename(id, this);
    } catch {
      // Fall back to the raw id when resolution fails.
    }
    const filename = resolvedFilename || String(id || "");
    if (!MUTATE_FILE.test(filename)) return exported;

    const original = exported.replaceConfigFile;
    exported.replaceConfigFile = async function rcfWithSandboxGuard(params) {
      try {
        return await original.call(this, params);
      } catch (err) {
        if (!err || err.code !== "EACCES") throw err;
        console.error(
          "[nemoclaw] Config is read-only in sandbox — plugin metadata not persisted (plugins auto-load from extensions/)",
        );
        const snapshot = params && params.snapshot;
        return {
          path: snapshot && snapshot.path,
          previousHash: undefined,
          snapshot,
          nextConfig: params && params.nextConfig,
          afterWrite: "noop",
          followUp: null,
        };
      }
    };
    wrapped = true;
    return exported;
  };
})();
