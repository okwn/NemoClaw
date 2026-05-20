<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Validation Plan: Issue #3814 — Rebuild/Upgrade Scenario Suite Migration

Generated from: `specs/2026-05-20_issue-3814-rebuild-upgrade-scenario-suites/spec.md`
Test Spec: `specs/2026-05-20_issue-3814-rebuild-upgrade-scenario-suites/tests.md`

## Overview

**Feature**: Migrate rebuild and upgrade E2E coverage from legacy monolithic scripts into context-driven scenario validation suites with stable assertion IDs and auditable parity mapping.

**Available Tools**: Bash, Vitest (`npm test`), `npx tsx`, `gh` CLI, filesystem checks, shell syntax checks.

## Coverage Summary

- Happy Paths: 8 scenarios
- Sad Paths: 5 scenarios
- Total: 13 scenarios

---

## Phase 1: Legacy Assertion Inventory and Parity Baseline - Validation Scenarios

### Scenario 1.1: Legacy rebuild/upgrade assertions are fully reviewed [STATUS: pending]

**Type**: Happy Path

**Given**: The four legacy scripts exist and the implementation has updated parity inventory or parity-map records.
**When**: The parity-map validation tests inspect records for rebuild and upgrade coverage.
**Then**: Every relevant assertion from the four legacy scripts is represented as mapped, deferred, or retired.

**Validation Steps**:
1. **Setup**: Bash: confirm the four legacy script paths exist under `test/e2e/`.
2. **Execute**: Vitest: run the parity-map and legacy-inventory scenario-framework tests.
3. **Verify**: Bash/Vitest output: confirm no uncategorized rebuild/upgrade assertion failures remain.

**Tools Required**: Bash, Vitest.

### Scenario 1.2: Uncategorized legacy assertion is rejected [STATUS: pending]

**Type**: Sad Path

**Given**: A rebuild/upgrade legacy assertion lacks a mapped/deferred/retired disposition.
**When**: The parity-map validation runs.
**Then**: Validation fails with a message identifying the script or assertion needing disposition.

**Validation Steps**:
1. **Setup**: Test fixture: create or simulate a parity-map record missing required disposition.
2. **Execute**: Vitest or `npx tsx scripts/e2e/check-parity-map.ts --root . --strict` against the fixture if fixture support exists.
3. **Verify**: Test output: non-zero/failing result names the missing disposition.

**Tools Required**: Vitest, `npx tsx`.

---

## Phase 2: Rebuild/Upgrade Primitive Library - Validation Scenarios

### Scenario 2.1: Primitive library is sourceable and side-effect free [STATUS: pending]

**Type**: Happy Path

**Given**: `test/e2e/validation_suites/lib/rebuild_upgrade.sh` exists.
**When**: A shell sources the helper library without invoking helper functions.
**Then**: The shell exits successfully and no install, onboard, rebuild, upgrade, or network action runs.

**Validation Steps**:
1. **Setup**: Bash: prepare a clean environment and optional PATH shims that fail if setup commands are invoked.
2. **Execute**: Bash: `bash -c 'source test/e2e/validation_suites/lib/rebuild_upgrade.sh'`.
3. **Verify**: Bash: exit code is 0 and no shim invocation log contains forbidden setup commands.

**Tools Required**: Bash.

### Scenario 2.2: Missing required context fails clearly [STATUS: pending]

**Type**: Sad Path

**Given**: The helper context validation function is called without required keys such as `E2E_CONTEXT_DIR`, `E2E_SCENARIO`, `E2E_AGENT`, `E2E_SANDBOX_NAME`, or `E2E_GATEWAY_URL`.
**When**: The validation function runs.
**Then**: It exits non-zero and reports the missing key name.

**Validation Steps**:
1. **Setup**: Bash/Vitest fixture: unset required context variables.
2. **Execute**: Bash: source the helper and invoke the context validation function.
3. **Verify**: Bash/Vitest: assert non-zero exit and stderr includes the missing key.

**Tools Required**: Bash, Vitest.

### Scenario 2.3: Helper checks work against fake context and command shims [STATUS: pending]

**Type**: Happy Path

**Given**: A temporary context directory and fake command shims provide sandbox, gateway, version, inference, policy, and config responses.
**When**: Rebuild/upgrade primitive functions run through suite scripts or direct helper tests.
**Then**: The functions pass and emit stable assertion IDs for successful checks.

**Validation Steps**:
1. **Setup**: Bash/Vitest: create fake `context.env`, marker files, and PATH shims.
2. **Execute**: Vitest: run helper success-path tests.
3. **Verify**: Vitest: assert PASS output includes expected `suite.rebuild.*` and `suite.upgrade.*` IDs.

**Tools Required**: Bash, Vitest.

---

## Phase 3: Scenario Suite Steps and Suite Metadata - Validation Scenarios

### Scenario 3.1: Rebuild and upgrade suites resolve domain-specific steps [STATUS: pending]

**Type**: Happy Path

**Given**: `test/e2e/validation_suites/suites.yaml` has rebuild and upgrade suite families.
**When**: The suite runner or metadata tests resolve `rebuild` and `upgrade`.
**Then**: Each family includes rebuild/upgrade-specific steps and is not only generic smoke coverage.

**Validation Steps**:
1. **Setup**: Bash: ensure new suite scripts are executable.
2. **Execute**: Vitest: run suite-runner/scenario metadata tests.
3. **Verify**: Vitest: assert resolved step paths include the rebuild/upgrade domain scripts.

**Tools Required**: Bash, Vitest.

### Scenario 3.2: Affected scenarios still support plan-only rendering [STATUS: pending]

**Type**: Happy Path

**Given**: Affected rebuild and upgrade scenario IDs are available.
**When**: `run-scenario.sh <id> --plan-only` runs for each affected scenario.
**Then**: The command exits 0, renders a plan, and does not execute suite actions.

**Validation Steps**:
1. **Setup**: Bash: identify affected rebuild and upgrade scenario IDs from scenario metadata.
2. **Execute**: Bash: run `bash test/e2e/runtime/run-scenario.sh <affected-id> --plan-only` for each ID.
3. **Verify**: Bash: exit code is 0 and output contains plan details without action execution markers.

**Tools Required**: Bash.

### Scenario 3.3: Suite script with missing context fails before hidden rediscovery [STATUS: pending]

**Type**: Sad Path

**Given**: A rebuild/upgrade suite script is invoked without scenario context.
**When**: The script runs.
**Then**: It fails with a context error instead of reinstalling NemoClaw, onboarding, creating a sandbox, or rediscovering setup state.

**Validation Steps**:
1. **Setup**: Bash: unset context variables and use PATH shims that fail if setup commands are invoked.
2. **Execute**: Bash/Vitest: run the suite script under test.
3. **Verify**: Bash/Vitest: assert non-zero exit, context error message, and no forbidden setup shim was called.

**Tools Required**: Bash, Vitest.

---

## Phase 4: Parity Map and Coverage Report Integration - Validation Scenarios

### Scenario 4.1: Strict parity-map validation passes [STATUS: pending]

**Type**: Happy Path

**Given**: `test/e2e/docs/parity-map.yaml` contains rebuild/upgrade mappings and metadata.
**When**: Strict parity-map validation runs.
**Then**: Validation exits 0.

**Validation Steps**:
1. **Setup**: Bash: ensure dependencies are installed.
2. **Execute**: Bash: `npx tsx scripts/e2e/check-parity-map.ts --root . --strict`.
3. **Verify**: Bash: exit code is 0.

**Tools Required**: Bash, `npx tsx`.

### Scenario 4.2: Duplicate assertion IDs are rejected unless reusable [STATUS: pending]

**Type**: Sad Path

**Given**: Two parity-map records share a stable assertion ID without explicit reusable metadata.
**When**: Parity-map validation runs.
**Then**: Validation fails and identifies the duplicate ID.

**Validation Steps**:
1. **Setup**: Vitest fixture: simulate duplicate stable IDs without `reusable: true`.
2. **Execute**: Vitest: run parity-map duplicate-ID validation test.
3. **Verify**: Vitest: assert failure names the duplicate ID.

**Tools Required**: Vitest.

### Scenario 4.3: Coverage report shows rebuild/upgrade disposition counts [STATUS: pending]

**Type**: Happy Path

**Given**: Coverage report tooling reads the updated parity map.
**When**: Coverage report tests or generation command runs.
**Then**: The report includes rebuild/upgrade mapped, deferred, and retired counts.

**Validation Steps**:
1. **Setup**: Bash: ensure parity-map is updated.
2. **Execute**: Vitest or report command: run coverage-report tests/generation.
3. **Verify**: Vitest/Bash: output includes rebuild and upgrade domains with disposition counts.

**Tools Required**: Bash, Vitest.

---

## Phase 5: PR Validation and 100%+ Parity Review - Validation Scenarios

### Scenario 5.1: Targeted local validation passes [STATUS: pending]

**Type**: Happy Path

**Given**: Implementation, suite metadata, helper library, and parity-map updates are complete.
**When**: Targeted scenario-framework tests and strict parity validation run locally.
**Then**: All commands pass.

**Validation Steps**:
1. **Setup**: Bash: install dependencies if needed.
2. **Execute**: Bash: `npm test -- test/e2e/scenario-framework-tests` and `npx tsx scripts/e2e/check-parity-map.ts --root . --strict`.
3. **Verify**: Bash: both commands exit 0.

**Tools Required**: Bash, Vitest, `npx tsx`.

### Scenario 5.2: PR parity evidence is missing or below 100% [STATUS: pending]

**Type**: Sad Path

**Given**: The PR or implementation notes omit parity evidence or report less than 100% parity.
**When**: Maintainer review checks the validation note.
**Then**: The PR is not considered complete until parity evidence is added or coverage gaps are explicitly deferred/retired with approved metadata.

**Validation Steps**:
1. **Setup**: `gh` CLI: open or inspect the PR body after implementation.
2. **Execute**: `gh` CLI/Bash: verify the PR body or implementation notes contain the parity result.
3. **Verify**: Human review: confirm the note states 100% or greater parity or documents approved exceptions.

**Tools Required**: `gh` CLI, human review.

---

## Summary

| Phase | Happy | Sad | Total | Passed | Failed | Pending |
|-------|-------|-----|-------|--------|--------|---------|
| Phase 1 | 1 | 1 | 2 | 0 | 0 | 2 |
| Phase 2 | 2 | 1 | 3 | 0 | 0 | 3 |
| Phase 3 | 2 | 1 | 3 | 0 | 0 | 3 |
| Phase 4 | 2 | 1 | 3 | 0 | 0 | 3 |
| Phase 5 | 1 | 1 | 2 | 0 | 0 | 2 |
| **Total** | **8** | **5** | **13** | **0** | **0** | **13** |
