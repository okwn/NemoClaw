// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  mintAgentKeyWithAccessToken,
  OAuthTimeoutError,
  pollForToken,
  refreshAccessTokenWithRefreshToken,
  requestDeviceCode,
  runDeviceCodeFlow,
} from "../../dist/lib/oauth-device-code";

describe("requestDeviceCode", () => {
  it("posts client metadata and returns a valid device code", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const result = await requestDeviceCode({
      portalBaseUrl: "https://portal.example",
      clientId: "client-1",
      scope: "scope-a",
      fetch: (async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body ?? "") });
        return new Response(
          JSON.stringify({
            device_code: "device-1",
            user_code: "USER-1",
            verification_uri: "https://portal.example/verify",
            expires_in: 900,
            interval: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });

    expect(result.device_code).toBe("device-1");
    expect(calls[0].url).toBe("https://portal.example/api/oauth/device/code");
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("scope")).toBe("scope-a");
  });

  it("surfaces device-code HTTP errors and invalid payloads", async () => {
    await expect(
      requestDeviceCode({
        fetch: (async () =>
          new Response(JSON.stringify({ error_description: "bad client" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "device_code_request_failed_http_400" });

    await expect(
      requestDeviceCode({
        fetch: (async () => new Response(JSON.stringify({ device_code: "device-only" }), { status: 200 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "device_code_response_invalid" });
  });
});

describe("pollForToken", () => {
  it("handles authorization_pending and slow_down before success", async () => {
    let now = 0;
    const waits: number[] = [];
    const statuses = [
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }),
      new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 900,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ];

    const token = await pollForToken(
      {
        device_code: "device-1",
        user_code: "USER-1",
        verification_uri: "https://portal.example/verify",
        expires_in: 900,
        interval: 0,
      },
      {
        now: () => now,
        sleep: async (ms) => {
          waits.push(ms);
          now += ms;
        },
        log: () => {},
        fetch: (async () => statuses.shift() ?? new Response("{}", { status: 500 })) as typeof fetch,
      },
    );

    expect(token.access_token).toBe("access-1");
    expect(waits).toEqual([1000, 1000, 6000]);
  });

  it("surfaces terminal OAuth poll states", async () => {
    const device = {
      device_code: "device-1",
      user_code: "USER-1",
      verification_uri: "https://portal.example/verify",
      expires_in: 900,
      interval: 1,
    };

    await expect(
      pollForToken(device, {
        sleep: async () => {},
        log: () => {},
        fetch: (async () => new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "access_denied" });

    await expect(
      pollForToken(device, {
        sleep: async () => {},
        log: () => {},
        fetch: (async () => new Response(JSON.stringify({ error: "expired_token" }), { status: 400 })) as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(OAuthTimeoutError);

    await expect(
      pollForToken(device, {
        sleep: async () => {},
        log: () => {},
        fetch: (async () => new Response(JSON.stringify({ error: "server_error" }), { status: 500 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "server_error" });
  });

  it("times out when approval never completes", async () => {
    let now = 0;
    await expect(
      pollForToken(
        {
          device_code: "device-1",
          user_code: "USER-1",
          verification_uri: "https://portal.example/verify",
          expires_in: 900,
          interval: 1,
        },
        {
          timeoutSeconds: 1,
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          log: () => {},
          fetch: (async () => new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })) as typeof fetch,
        },
      ),
    ).rejects.toBeInstanceOf(OAuthTimeoutError);
  });

  it("rejects successful token responses missing an access token", async () => {
    await expect(
      pollForToken(
        {
          device_code: "device-1",
          user_code: "USER-1",
          verification_uri: "https://portal.example/verify",
          expires_in: 900,
          interval: 1,
        },
        {
          sleep: async () => {},
          log: () => {},
          fetch: (async () =>
            new Response(
              JSON.stringify({
                refresh_token: "refresh-1",
                expires_in: 900,
                token_type: "Bearer",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            )) as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({
      name: "OAuthError",
      code: "token_response_missing_tokens",
    });
  });
});

describe("refreshAccessTokenWithRefreshToken", () => {
  it("uses the host-side refresh-token grant form body", async () => {
    const calls: Array<{ url: string; body: string; signal: AbortSignal | null }> = [];
    const token = await refreshAccessTokenWithRefreshToken("refresh-1", {
      fetch: (async (url, init) => {
        calls.push({
          url: String(url),
          body: String(init?.body ?? ""),
          signal: init?.signal instanceof AbortSignal ? init.signal : null,
        });
        return new Response(
          JSON.stringify({
            access_token: "access-2",
            refresh_token: "refresh-2",
            expires_in: 900,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });

    expect(token.access_token).toBe("access-2");
    expect(token.refresh_token).toBe("refresh-2");
    expect(calls[0]?.url).toBe(
      "https://portal.nousresearch.com/api/oauth/token",
    );
    expect(new URLSearchParams(calls[0]?.body).get("grant_type")).toBe(
      "refresh_token",
    );
    expect(new URLSearchParams(calls[0]?.body).get("refresh_token")).toBe(
      "refresh-1",
    );
    expect(new URLSearchParams(calls[0]?.body).get("client_id")).toBe(
      "hermes-cli",
    );
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects refresh responses missing tokens", async () => {
    await expect(
      refreshAccessTokenWithRefreshToken("refresh-1", {
        fetch: (async () =>
          new Response(JSON.stringify({ access_token: "access-only" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "token_response_missing_tokens" });
  });

  it("surfaces refresh-token grant errors", async () => {
    await expect(
      refreshAccessTokenWithRefreshToken("bad-refresh", {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "refresh token expired",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          )) as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "OAuthError",
      code: "invalid_grant",
      description: "refresh token expired",
    });
  });
});

describe("mintAgentKeyWithAccessToken", () => {
  it("mints a short-lived agent key with Authorization bearer auth", async () => {
    const calls: Array<{
      url: string;
      auth: string | null;
      body: string;
      signal: AbortSignal | null;
    }> = [];
    const key = await mintAgentKeyWithAccessToken("access-1", {
      minTtlSeconds: 120,
      fetch: (async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(url),
          auth: headers.get("authorization"),
          body: String(init?.body ?? ""),
          signal: init?.signal instanceof AbortSignal ? init.signal : null,
        });
        return new Response(
          JSON.stringify({
            api_key: "agent-key-1",
            key_id: "key-1",
            expires_in: 1800,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });

    expect(key.api_key).toBe("agent-key-1");
    expect(calls[0]?.url).toBe(
      "https://portal.nousresearch.com/api/oauth/agent-key",
    );
    expect(calls[0]?.auth).toBe("Bearer access-1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      min_ttl_seconds: 120,
    });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("enforces minimum TTL and validates mint responses", async () => {
    const bodies: string[] = [];
    await mintAgentKeyWithAccessToken("access-1", {
      minTtlSeconds: 1,
      fetch: (async (_url, init) => {
        bodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ api_key: "agent-key-1" }), { status: 200 });
      }) as typeof fetch,
    });
    expect(JSON.parse(bodies[0])).toEqual({ min_ttl_seconds: 60 });

    await expect(
      mintAgentKeyWithAccessToken("access-1", {
        fetch: (async () => new Response(JSON.stringify({ error: "denied" }), { status: 403 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "denied" });

    await expect(
      mintAgentKeyWithAccessToken("access-1", {
        fetch: (async () => new Response(JSON.stringify({ key_id: "missing-key" }), { status: 200 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "agent_key_response_missing_api_key" });
  });
});

describe("runDeviceCodeFlow", () => {
  it("prints copy-paste instructions and completes without opening a browser when disabled", async () => {
    const logs: string[] = [];
    const responses = [
      new Response(
        JSON.stringify({
          device_code: "device-1",
          user_code: "USER-1",
          verification_uri: "https://portal.example/verify",
          expires_in: 900,
          interval: 1,
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 900,
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    ];

    const token = await runDeviceCodeFlow({
      noBrowser: true,
      sleep: async () => {},
      log: (line) => logs.push(line),
      fetch: (async () => responses.shift() ?? new Response("{}", { status: 500 })) as typeof fetch,
    });

    expect(token.access_token).toBe("access-1");
    expect(logs.join("\n")).toContain("Then enter this code: USER-1");
    expect(logs.join("\n")).toContain("Hermes Provider authorization complete");
  });
});
