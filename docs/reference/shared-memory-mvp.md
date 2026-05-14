<!--
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# OpenShell Shared Agent Memory MVP

This page documents the shared agent memory MVP implemented across OpenShell, NemoClaw, and Hermes.
The design uses OpenShell as the driver boundary, Redis Streams as the MVP backend, and thin runtime adapters for each agent.

The core decision is simple: OpenShell owns durable shared memory.
NemoClaw configures and demonstrates the integration.
Agent runtimes own their adapters.

## Decision Summary

The MVP uses an append-only memory event log with scoped queries and durable subscriptions.
It does not use direct Redis access from agents, shared writable files, or runtime-specific memory formats as the cross-agent contract.

Key decisions:

- OpenShell exposes the shared memory API.
- Redis Streams provide the MVP storage and delivery backend.
- NemoClaw passes only sandbox-safe memory configuration into agent sandboxes.
- Redis credentials stay in the OpenShell gateway process.
- OpenClaw and Hermes use separate adapters that call the same OpenShell memory API.
- `subscribe` creates a durable filtered inbox.
- `poll` pulls pending events from that subscription inbox.
- `ack` records that the subscriber has processed the event.

## Current Status

The MVP is implemented on the shared-memory feature branches.

| Area | Branch | Status |
|---|---|---|
| NemoClaw integration and OpenClaw adapter | `NVIDIA/NemoClaw:aniket/feat-shared-agent-memory` | Implemented |
| OpenShell memory driver and Redis backend | `aknvda/OpenShell:aniket/feat-shared-agent-memory` | Implemented |
| Hermes shared-memory adapter | `aknvda/hermes-agent:aniket/feat-shared-agent-memory` | Implemented |

The local runnable demo is `examples/shared-memory/run-local-demo.sh`.

## Problem

NemoClaw can run multiple sandboxes and agent runtimes, but each runtime normally owns its own workspace and memory model.
That is enough for one assistant.
It is not enough when different agents need to coordinate on durable facts, task state, findings, or handoffs.

Shared filesystem memory is not the right primitive.
It couples agents to one file layout, makes replay and audit difficult, and gives the platform little control over provenance, policy, retention, or secret handling.

The MVP solves this with a platform-managed memory API.
Agents publish structured events into a scoped stream and subscribe to the event types they need.

## Value Proposition

Shared Agent Memory provides durable, scoped, auditable memory exchange for heterogeneous agents through an agent-neutral API.

For operators, it gives continuity across sandboxes and agent runtimes.
For agent developers, it gives a stable integration contract.
For platform maintainers, it creates one policy and audit boundary for durable agent memory.

The practical outcome is that OpenClaw, Hermes, and future agents can coordinate without knowing each other's implementation details or storage backend.

## Goals

The MVP provides:

- Agent-neutral publish, query, subscribe, poll, and acknowledge operations.
- Redis Streams backed durability.
- Pull-based subscriptions with acknowledgement.
- Scoped queries by event type, subject, provenance, and time.
- Provenance on every event.
- Schema validation before persistence.
- Secret scanning before persistence.
- No Redis credentials inside agent sandboxes.
- Thin OpenClaw and Hermes adapters over the same OpenShell API.
- A runnable OpenClaw plus Hermes acceptance demo.

## Non Goals

The MVP intentionally does not include:

- Vector search.
- Semantic conflict resolution.
- Multi-region replication.
- Distributed consensus.
- Agent trust scoring.
- Direct Redis access from agent processes.
- A permanent NemoClaw-owned memory service.

Those capabilities can be added after the event, subscription, and policy contract is stable.

## Ownership Boundaries

The implementation is split by platform responsibility.

| Layer | Owner | Responsibility |
|---|---|---|
| Memory platform | OpenShell | Memory API, Redis driver, backend credentials, validation, policy, delivery, replay, and acknowledgement. |
| Reference integration | NemoClaw | Onboarding configuration, sandbox-safe environment, registry metadata, OpenClaw adapter packaging, docs, examples, and demo. |
| Runtime adapter | Each agent runtime | Mapping shared memory operations into native tools, memory, sessions, plans, or task state. |

NemoClaw must not own shared memory semantics.
It should configure and demonstrate the OpenShell platform primitive.

The OpenClaw adapter currently lives in NemoClaw because NemoClaw builds the OpenClaw sandbox image and plugin assets.
The Hermes adapter lives in the Hermes repo because Hermes owns its tool interface and runtime behavior.

## Architecture

Agents call a memory service through an OpenShell-managed endpoint.
The service validates requests, applies policy, scans payloads, writes to Redis Streams, and serves query and subscription reads.

```text
OpenClaw adapter        Hermes adapter        Future agent adapter
      |                       |                       |
      +----------- OpenShell shared memory API -------+
                          |
                 OpenShell memory service
                          |
                 Redis Streams memory driver
```

This boundary keeps backend credentials, policy, validation, and audit independent of the agent runtime.

## Repository Layout

### OpenShell

The OpenShell branch contains the platform primitive.

Implemented files:

```text
crates/openshell-server/src/memory.rs
crates/openshell-sandbox/src/memory_local.rs
crates/openshell-server/src/http.rs
crates/openshell-server/src/lib.rs
crates/openshell-sandbox/src/lib.rs
crates/openshell-sandbox/src/proxy.rs
```

The MVP is HTTP-first.
That keeps the contract easy to exercise while the semantics settle.
The sandbox-local `memory.local` route forwards memory calls to the gateway without exposing Redis to the sandbox.

### NemoClaw

The NemoClaw branch contains the reference integration and the OpenClaw adapter.

Implemented files:

```text
src/lib/shared-memory.ts
src/lib/shared-memory.test.ts
src/lib/onboard.ts
src/lib/onboard/dockerfile-patch.ts
src/lib/state/registry.ts
src/lib/inventory/index.ts
scripts/generate-openclaw-config.py
nemoclaw-blueprint/openclaw-plugins/shared-memory/
examples/shared-memory/
docs/reference/shared-memory-mvp.md
```

NemoClaw resolves shared-memory configuration during onboarding, stores non-secret registry metadata, passes sandbox-safe environment to the agent, and conditionally installs the OpenClaw adapter.

### Hermes

The Hermes branch contains the Hermes adapter.

Implemented files:

```text
tools/shared_memory_tool.py
toolsets.py
tests/test_shared_memory_tool.py
```

The NemoClaw demo calls this adapter through `examples/shared-memory/hermes-agent.py`.
The adapter uses the same OpenShell memory API as OpenClaw.

## Configuration

Enable the MVP with environment variables during NemoClaw onboarding.

```console
$ NEMOCLAW_SHARED_MEMORY=redis \
  OPENSHELL_MEMORY_REDIS_URL=redis://127.0.0.1:6379 \
  NEMOCLAW_SHARED_MEMORY_SCOPE=workspace:nemoclaw \
  nemoclaw onboard
```

Optional endpoint override:

```console
$ OPENSHELL_MEMORY_URL=http://memory.local/v1
```

NemoClaw validates the Redis URL, scope, and memory endpoint.
It sends only the following sandbox-safe values into the agent environment:

```text
NEMOCLAW_SHARED_MEMORY=1
OPENSHELL_MEMORY_BACKEND=redis
OPENSHELL_MEMORY_SCOPE=workspace:nemoclaw
OPENSHELL_MEMORY_URL=http://memory.local/v1
```

`OPENSHELL_MEMORY_REDIS_URL` remains host-side and is not sent to agent sandboxes.

## API Contract

The MVP contract is intentionally small.

| Operation | Route | Purpose |
|---|---|---|
| Publish | `POST /v1/memory/events` | Append a scoped memory event. |
| Query | `GET /v1/memory/query` | Read events by deterministic filters. |
| Subscribe | `POST /v1/memory/subscriptions` | Create a durable filtered inbox. |
| Poll | `GET /v1/memory/subscriptions/{id}/poll` | Pull pending events from the subscription inbox. |
| Ack | `POST /v1/memory/subscriptions/{id}/ack` | Mark events as processed by the subscriber. |

Sandboxed agents should use:

```text
http://memory.local/v1/memory/events
http://memory.local/v1/memory/query
http://memory.local/v1/memory/subscriptions
```

Local demos can call the gateway directly through `http://127.0.0.1:<port>/v1`.

## Event Schema

Memory events are append-only.
Materialized views may be added later, but the original event remains the audit source.

```json
{
  "id": "evt_01j...",
  "type": "release.blocker.detected",
  "scope": "workspace:nemoclaw",
  "subject": "shared-memory-mvp/hermes-adapter-smoke",
  "content": {
    "summary": "The Hermes adapter smoke path must pass before the shared-memory MVP demo is marked ready.",
    "recommendation": "Validate subscribe, pull, acknowledge, and response publishing against the OpenShell memory driver."
  },
  "provenance": {
    "agent_id": "openclaw:demo",
    "runtime": "openclaw",
    "sandbox_id": "shared-memory-demo",
    "source": "agent_observation"
  },
  "visibility": "shared",
  "sensitivity": "normal",
  "schema_version": 1,
  "created_at": "2026-05-14T00:00:00Z"
}
```

Required fields:

| Field | Purpose |
|---|---|
| `id` | Service-assigned stable event identifier. |
| `type` | Dot-delimited event type. |
| `scope` | Sharing boundary such as `workspace:nemoclaw`. |
| `subject` | Stable entity or topic within the scope. |
| `content` | Structured payload. |
| `provenance` | Agent, runtime, sandbox, and source information. |
| `visibility` | Sharing level such as `private`, `shared`, or `public`. |
| `sensitivity` | Policy hint such as `normal`, `confidential`, or `secret_candidate`. |
| `schema_version` | Event schema version. |
| `created_at` | Service-side timestamp. |

## Scope Model

Scopes define who can query an event and which subscribers can receive it.

Initial scope prefixes:

| Prefix | Example | Use |
|---|---|---|
| `user` | `user:aniket` | User-level preferences and context. |
| `workspace` | `workspace:nemoclaw` | Shared workspace memory across sandboxes. |
| `project` | `project:NemoClaw` | Repository or project facts. |
| `sandbox` | `sandbox:shared-memory-demo` | Runtime-local observations. |

Agents should publish to explicit scopes.
They should not rely on a global default scope.

## Subscription Semantics

Subscriptions use pull delivery in the MVP.
This is deliberate.

`subscribe` creates a durable filtered inbox with cursor and acknowledgement state.
`poll` pulls pending events from that inbox when the agent is ready to consume them.
`poll` is not an extra query step and does not mean the agent missed a push notification.

Pull delivery is a strong first contract because agents can be offline, restarted, busy, or rate-limited.
Future OpenShell delivery modes can add webhooks, server-sent events, WebSockets, or sandbox wakeups without changing the event schema.

Example subscription:

```json
{
  "subscription_id": "release-shared-memory-hermes",
  "subscriber": {
    "agent_id": "hermes:demo",
    "runtime": "hermes",
    "sandbox_id": "shared-memory-demo"
  },
  "scope": "workspace:nemoclaw-demo",
  "filters": {
    "types": ["release.*"]
  },
  "delivery": "pull"
}
```

Subscribers should acknowledge events after they integrate or intentionally ignore them.

## Redis Driver

Redis Streams are the MVP source of truth for event delivery.
Plain Redis Pub/Sub is not sufficient because offline subscribers miss messages.

Core operations:

| Memory operation | Redis operation | Purpose |
|---|---|---|
| Publish | `XADD` | Append an event to the scoped stream. |
| Subscribe | Consumer group state | Track durable subscriber position. |
| Poll | Stream read | Return pending or new events for a subscriber. |
| Ack | Acknowledgement state | Mark events as processed. |
| Query | Stream scan or materialized view | Return deterministic filtered events. |

Redis stays behind the OpenShell memory service.
Future drivers can replace Redis without changing the agent adapter contract.

## Adapter Contract

Every runtime adapter exposes the same conceptual operations:

```text
shared_memory_publish
shared_memory_query
shared_memory_subscribe
shared_memory_poll
shared_memory_ack
```

Adapters are thin by design.
They translate between the agent runtime and OpenShell memory events.
They do not own backend credentials, retention, policy, or cross-agent semantics.

## Security Invariants

Shared memory is durable platform state.
The MVP keeps these invariants:

- Agents never receive Redis credentials.
- Agents call only the OpenShell memory endpoint.
- Events are schema-validated before persistence.
- Event content is scanned for secret-like material before persistence.
- Every event carries provenance.
- Scope checks happen at the OpenShell service boundary.
- Subscription state is per subscriber.
- Acknowledgement state is durable.
- Audit logs can record publish, subscription creation, poll, and ack operations.

The service rejects events that look like API keys, tokens, private keys, or credential files unless a future administrative policy explicitly allows them.
Rejected payload bodies should not be stored.

## Conflict Handling

The MVP preserves competing events instead of resolving semantic conflicts automatically.

For example, OpenClaw and Hermes may both publish `release.blocker.detected` for the same subject.
The memory service stores both events with provenance.
A later materialized view can mark one event as latest, accepted, superseded, or rejected.

Conflict metadata can use:

| Field | Purpose |
|---|---|
| `subject` | Groups related events. |
| `idempotency_key` | Prevents duplicate writes from retries. |
| `supersedes` | Links an event to the event it replaces. |
| `status` | Tracks `proposed`, `accepted`, `superseded`, or `rejected`. |

The trusted local demo uses accepted events.
Production policy can add approval workflows later.

## Acceptance Demo

The acceptance demo proves that shared memory works across agent runtimes.
It uses a release-validation handoff:

1. Start Redis.
2. Start the OpenShell gateway with the memory backend enabled.
3. Configure OpenClaw and Hermes with the same scope, `workspace:nemoclaw-demo`.
4. Hermes subscribes to `release.*`.
5. OpenClaw publishes `release.blocker.detected` for `shared-memory-mvp/hermes-adapter-smoke`.
6. Hermes polls its subscription inbox and receives the OpenClaw blocker.
7. Hermes acknowledges the blocker.
8. Hermes publishes `release.remediation.planned`.
9. OpenClaw queries `release.remediation.planned` and sees the Hermes response.
10. Both agents use only the OpenShell memory API.
11. Redis credentials remain in the OpenShell gateway process.

Run the local demo from the NemoClaw branch:

```console
$ examples/shared-memory/run-local-demo.sh
```

The script starts Redis, starts the OpenShell gateway, loads the OpenClaw adapter from this NemoClaw branch, loads the Hermes adapter from the Hermes repo, and exercises publish, subscribe, poll, acknowledge, publish, and query through OpenShell.

Override repo locations when needed:

```console
$ OPENSHELL_REPO=/path/to/OpenShell \
  HERMES_REPO=/path/to/hermes-agent \
  examples/shared-memory/run-local-demo.sh
```

## Verification

The MVP branch has been verified with:

```console
$ npx vitest run src/lib/shared-memory.test.ts src/lib/inventory/index.test.ts src/lib/onboard/dockerfile-patch.test.ts test/generate-openclaw-config.test.ts test/registry.test.ts test/openclaw-shared-memory-plugin.test.ts
$ npm run docs
$ examples/shared-memory/run-local-demo.sh
```

The local demo completed end to end with Redis, the OpenShell gateway, the OpenClaw adapter, and the Hermes adapter.

## Remaining Hardening

Before broad production use, the platform work should add:

- Authenticated memory calls.
- Per-scope access policy.
- More explicit retention and redaction behavior.
- Direct OpenShell gateway smoke tests for publish, subscribe, poll, and ack.
- A stable OpenShell API surface, either HTTP-only or HTTP plus gRPC.
- Operator-facing policy for `accepted` versus `proposed` publish status.
- Rebuildable materialized views for query acceleration.
- A decision on whether the OpenClaw adapter remains NemoClaw-packaged or moves to an OpenClaw-owned distribution.
- Optional push delivery for wakeups after pull delivery remains the durable baseline.

## Bottom Line

The MVP validates the integration model the lead engineer described.
NemoClaw does not change its internal memory model.
Instead, it integrates with an OpenShell-owned shared memory driver and packages the OpenClaw side of the demo.

That gives OpenClaw, Hermes, and future agents a common coordination layer while keeping platform memory semantics, credentials, policy, and audit inside OpenShell.
