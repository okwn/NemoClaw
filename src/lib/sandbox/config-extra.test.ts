// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  classifyNewKeyGate,
  extractDotpath,
  findClobberingAncestor,
  formatConfigValueForLogs,
  parseConfig,
  privilegedSandboxExecArgv,
  selectDockerDriverSandboxContainer,
  setDotpath,
  validateConfigDotpath,
  validateUrlValue,
  validateUrlValueWithDns,
  rewriteConfigUrlsWithDnsPinning,
} from "../../../dist/lib/sandbox/config";

describe("sandbox config helpers", () => {
  it("extracts nested object and array dotpaths", () => {
    const config = { a: { b: [{ c: 3 }] } };
    expect(extractDotpath(config, "a.b.0.c")).toBe(3);
    expect(extractDotpath(config, "a.b.x.c")).toBeUndefined();
    expect(extractDotpath(config, "a.missing.value")).toBeUndefined();
  });

  it("sets missing object ancestors without clobbering siblings", () => {
    const config = { existing: true };
    setDotpath(config, "a.b.c", 3);
    expect(config).toEqual({ existing: true, a: { b: { c: 3 } } });
  });

  it("validates dotpath syntax and reserved segments", () => {
    expect(validateConfigDotpath("model.name")).toEqual({ ok: true });
    expect(validateConfigDotpath("")).toMatchObject({ ok: false, reason: "key is empty" });
    expect(validateConfigDotpath("model..name")).toMatchObject({ ok: false });
    expect(validateConfigDotpath("model.__proto__.polluted")).toMatchObject({ ok: false });
  });

  it("detects array and scalar ancestors that config set would clobber", () => {
    expect(findClobberingAncestor({ list: [] }, "list.0.name")).toMatchObject({
      segment: "list.0",
    });
    expect(findClobberingAncestor({ model: "qwen" }, "model.name")).toMatchObject({
      segment: "model",
    });
    expect(findClobberingAncestor({ model: { name: "qwen" } }, "model.name")).toBeNull();
    expect(findClobberingAncestor("root-scalar", "model.name")).toMatchObject({ segment: "(root)" });
  });

  it("classifies new-key gates from explicit override, TTY, and non-interactive inputs", () => {
    expect(classifyNewKeyGate({ acceptNewPath: true })).toEqual({ mode: "accept" });
    expect(classifyNewKeyGate({ acceptEnv: "1" })).toEqual({ mode: "accept" });
    expect(classifyNewKeyGate({ isTTY: true })).toEqual({ mode: "prompt" });
    expect(classifyNewKeyGate({ isTTY: true, nonInteractiveEnv: "1" })).toEqual({ mode: "refuse" });
    expect(classifyNewKeyGate({ isTTY: false })).toEqual({ mode: "refuse" });
  });

  it("parses JSON and YAML config objects and rejects non-objects", () => {
    expect(parseConfig('{"model":"qwen"}', "json")).toEqual({ model: "qwen" });
    expect(parseConfig("model: qwen\n", "yaml")).toEqual({ model: "qwen" });
    expect(() => parseConfig("[]", "json")).toThrow(/Config is not an object/);
  });

  it("redacts strings, URLs, and credential fields in config previews", () => {
    expect(formatConfigValueForLogs(undefined)).toBe("(not set)");
    expect(formatConfigValueForLogs("secret")).toBe('"[REDACTED_STRING]"');
    expect(formatConfigValueForLogs("https://example.com/token?q=1")).toBe('"[REDACTED_URL]"');
    expect(formatConfigValueForLogs({ apiKey: "secret", nested: ["safe"] })).toBe(
      '{"apiKey":"[REDACTED]","nested":["[REDACTED_STRING]"]}',
    );
  });

  it("validates URL hosts before config writes", async () => {
    expect(() => validateUrlValue("not-a-url")).not.toThrow();
    expect(() => validateUrlValue("https://example.com/path")).not.toThrow();
    expect(() => validateUrlValue("http://127.0.0.1:8080")).toThrow(/private\/internal/);

    await expect(
      validateUrlValueWithDns("https://public.example", async () => [{ address: "93.184.216.34", family: 4 }]),
    ).resolves.toBeUndefined();
    await expect(
      validateUrlValueWithDns("https://private.example", async () => [{ address: "10.0.0.5", family: 4 }]),
    ).rejects.toThrow(/resolves to private/);
  });

  it("pins HTTP URLs after DNS validation but preserves HTTPS hostnames", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(rewriteConfigUrlsWithDnsPinning("http://example.com/path", lookup)).resolves.toBe(
      "http://93.184.216.34/path",
    );
    await expect(rewriteConfigUrlsWithDnsPinning("https://example.com/path", lookup)).resolves.toBe(
      "https://example.com/path",
    );
    await expect(rewriteConfigUrlsWithDnsPinning({ urls: ["not-a-url"] }, lookup)).resolves.toEqual({
      urls: ["not-a-url"],
    });
  });

  it("selects docker-driver sandbox containers by exact name or prefix", () => {
    expect(selectDockerDriverSandboxContainer("alpha", "vm", "openshell-alpha")).toBeNull();
    expect(selectDockerDriverSandboxContainer("alpha", "docker", "other\nopenshell-alpha-worker")).toBe(
      "openshell-alpha-worker",
    );
    expect(selectDockerDriverSandboxContainer("alpha", "docker", "openshell-alpha\nother")).toBe(
      "openshell-alpha",
    );
  });

  it("builds kubectl fallback argv when no docker-driver container resolves", () => {
    expect(privilegedSandboxExecArgv("alpha", ["cat", "/config"], true)).toEqual([
      "exec",
      "-i",
      "openshell-cluster-nemoclaw",
      "kubectl",
      "exec",
      "-n",
      "openshell",
      "alpha",
      "-c",
      "agent",
      "-i",
      "--",
      "cat",
      "/config",
    ]);
  });
});
