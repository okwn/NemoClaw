// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Import from compiled dist/ so coverage is attributed correctly.
import { createTarball, getDebugCompletionMessages, redact, runDebug } from "../../../dist/lib/diagnostics/debug";

describe("redact", () => {
  it("redacts NVIDIA_API_KEY=value patterns", () => {
    const key = ["NVIDIA", "API", "KEY"].join("_");
    expect(redact(`${key}=some-value`)).toBe(`${key}=<REDACTED>`);
  });

  it("redacts generic KEY/TOKEN/SECRET/PASSWORD env vars", () => {
    expect(redact("API_KEY=secret123")).toBe("API_KEY=<REDACTED>");
    expect(redact("MY_TOKEN=tok_abc")).toBe("MY_TOKEN=<REDACTED>");
    expect(redact("DB_PASSWORD=hunter2")).toBe("DB_PASSWORD=<REDACTED>");
    expect(redact("MY_SECRET=s3cret")).toBe("MY_SECRET=<REDACTED>");
    expect(redact("CREDENTIAL=cred")).toBe("CREDENTIAL=<REDACTED>");
  });

  it("redacts nvapi- prefixed keys", () => {
    expect(redact("using key nvapi-AbCdEfGhIj1234")).toBe("using key <REDACTED>");
  });

  it("redacts classic GitHub personal access tokens (ghp_)", () => {
    expect(redact("token: ghp_" + "a".repeat(36))).toBe("token: <REDACTED>");
  });

  it("redacts fine-grained GitHub personal access tokens (github_pat_)", () => {
    expect(redact("token: github_pat_" + "A".repeat(40))).toBe("token: <REDACTED>");
  });

  it("redacts Bearer tokens", () => {
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(
      "Authorization: Bearer <REDACTED>",
    );
  });

  it("handles multiple patterns in one string", () => {
    const input = "API_KEY=secret nvapi-abcdefghijk Bearer tok123";
    const result = redact(input);
    expect(result).not.toContain("secret");
    expect(result).not.toContain("nvapi-abcdefghijk");
    expect(result).not.toContain("tok123");
  });

  it("leaves clean text unchanged", () => {
    const clean = "Hello world, no secrets here";
    expect(redact(clean)).toBe(clean);
  });
});

describe("createTarball", () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("sets process.exitCode = 1 and returns false when tar fails on invalid output path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "debug-test-"));
    writeFileSync(join(tempDir, "dummy.txt"), "test data");
    const ok = createTarball(tempDir, "/nonexistent/path/debug.tar.gz");
    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("creates tarball successfully and returns true for valid output path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "debug-test-"));
    writeFileSync(join(tempDir, "dummy.txt"), "test data");
    // Write output to a SEPARATE directory — writing into the source dir
    // causes tar to see the file changing as it reads, returning exit 1.
    outputDir = mkdtempSync(join(tmpdir(), "debug-test-out-"));
    const output = join(outputDir, "output.tar.gz");
    const ok = createTarball(tempDir, output);
    expect(ok).toBe(true);
    expect(process.exitCode).toBeUndefined();
    expect(existsSync(output)).toBe(true);
  });
});

describe("runDebug", () => {
  const originalPath = process.env.PATH;
  let fakeBin: string | undefined;

  afterEach(() => {
    process.env.PATH = originalPath;
    vi.restoreAllMocks();
    if (fakeBin) rmSync(fakeBin, { recursive: true, force: true });
    fakeBin = undefined;
  });

  function installFakeCommand(name: string, body: string): void {
    fakeBin ??= mkdtempSync(join(tmpdir(), "debug-bin-"));
    const file = join(fakeBin, name);
    writeFileSync(file, `#!/bin/sh\n${body}`);
    chmodSync(file, 0o755);
    process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
  }

  it("collects diagnostics and redacts command output", () => {
    for (const name of [
      "date",
      "uname",
      "uptime",
      "free",
      "df",
      "nvidia-smi",
      "top",
      "ss",
      "ip",
      "nslookup",
      "lsof",
      "vmstat",
      "iostat",
      "dmesg",
      "ssh",
    ]) {
      installFakeCommand(name, `echo ${name}-ok`);
    }
    installFakeCommand("curl", "echo 200");
    installFakeCommand(
      "docker",
      'case "$*" in *"--format {{.Names}}"*) echo container-one; exit 0;; esac\necho "docker $* API_KEY=secret"\n',
    );
    installFakeCommand(
      "openshell",
      'if [ "$1 $2" = "sandbox list" ]; then echo "Name"; echo "alpha Ready"; exit 0; fi\nif [ "$1 $2" = "sandbox ssh-config" ]; then echo "Host openshell-alpha"; echo "  HostName 127.0.0.1"; exit 0; fi\necho "openshell $*"\n',
    );

    const output: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((message = "") => output.push(String(message)));
    const err = vi.spyOn(console, "error").mockImplementation((message = "") => output.push(String(message)));

    runDebug({ sandboxName: "alpha", quick: false });

    expect(log).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("Collecting diagnostics for sandbox 'alpha'");
    expect(output.join("\n")).toContain("docker ps -a API_KEY=<REDACTED>");
    expect(output.join("\n")).toContain("ssh-ok");
    expect(output.join("\n")).toContain("Done. If filing a bug");
  });
});

describe("getDebugCompletionMessages", () => {
  it("suggests --output when no tarball path is provided", () => {
    expect(getDebugCompletionMessages()).toEqual([
      "Done. If filing a bug, run with --output and attach the tarball to your issue:",
      "  nemoclaw debug --output /tmp/nemoclaw-debug.tar.gz",
    ]);
  });

  it("omits the redundant --output hint when a tarball was already written", () => {
    expect(getDebugCompletionMessages("/tmp/nemoclaw-debug.tar.gz")).toEqual([]);
  });
});
