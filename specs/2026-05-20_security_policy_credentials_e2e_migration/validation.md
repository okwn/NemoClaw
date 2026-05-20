# Validation Plan: Security Policy and Credential E2E Migration

Generated from: `specs/2026-05-20_security_policy_credentials_e2e_migration/spec.md`  
Test Spec: `specs/2026-05-20_security_policy_credentials_e2e_migration/tests.md`

## Overview

**Feature**: Migrate security policy and credential legacy E2E coverage into the layered scenario framework with focused suite steps, stable assertion IDs, and parity metadata.

**Available Tools**: Bash, Vitest, `npm test`, `test/e2e/runtime/run-scenario.sh`, `test/e2e/runtime/run-suites.sh`, `tsx`, `gh` CLI for PR/CI checks.

## Coverage Summary

- Happy Paths: 6 scenarios
- Sad Paths: 6 scenarios
- Total: 12 scenarios

---

## Phase 1: Coverage Inventory and Primitive Contract - Validation Scenarios

### Scenario 1.1: Domain helper loads and uses scenario context [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Happy Path

**Given**: A temporary `E2E_CONTEXT_DIR/context.env` with required scenario keys and `E2E_DRY_RUN=1`.
**When**: The security policy credentials helper is sourced and a primitive reads required context.
**Then**: The helper exits successfully, reports dry-run-safe planned behavior, and does not discover install/onboard/sandbox state independently.

**Validation Steps**:
1. **Setup**: Bash: create a temp context directory with minimal required keys.
2. **Execute**: Bash/Vitest: source `test/e2e/validation_suites/lib/security_policy_credentials.sh` through the helper test.
3. **Verify**: Vitest: assert success and expected context-derived output.

**Tools Required**: Bash, Vitest

### Scenario 1.2: Missing context fails clearly [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Sad Path

**Given**: A temp context directory with a missing required key.
**When**: A security helper primitive requiring that key runs.
**Then**: The command fails non-zero and names the missing context key without attempting setup rediscovery.

**Validation Steps**:
1. **Setup**: Bash: create incomplete `context.env`.
2. **Execute**: Vitest/Bash: invoke the helper primitive.
3. **Verify**: Vitest: assert non-zero status and clear missing-key message.

**Tools Required**: Bash, Vitest

## Phase 2: Credential and Sanitization Suite Migration - Validation Scenarios

### Scenario 2.1: Credential suite runs focused steps in dry-run mode [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Happy Path

**Given**: `suites.yaml` includes `security-credentials` and a dry-run context.
**When**: `run-suites.sh security-credentials` runs with `E2E_DRY_RUN=1`.
**Then**: Credential-specific scripts under `security/credentials/` run in declared order and emit/represent stable credential assertion IDs.

**Validation Steps**:
1. **Setup**: Bash: seed full dry-run context.
2. **Execute**: Bash: run `test/e2e/runtime/run-suites.sh security-credentials`.
3. **Verify**: Bash/Vitest: inspect output and `suites.yaml` script paths.

**Tools Required**: Bash, Vitest

### Scenario 2.2: Credential outputs do not leak raw secrets [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Sad Path

**Given**: Credential fixture data contains credential-shaped raw values.
**When**: Credential list/sanitization helpers run.
**Then**: Raw values are redacted or absent, and only provider/name/header metadata is visible.

**Validation Steps**:
1. **Setup**: Bash/Vitest: create fixture output with obvious secret patterns.
2. **Execute**: Vitest: run credential helper/suite in dry-run or fixture mode.
3. **Verify**: Vitest: assert raw values are not present in stdout/stderr/artifacts.

**Tools Required**: Bash, Vitest

## Phase 3: Security Policy, Shields, and Gateway Health Migration - Validation Scenarios

### Scenario 3.1: Policy and shields suites use focused post-onboard checks [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Happy Path

**Given**: `security-policy` and `security-shields` are configured in `suites.yaml`.
**When**: The suites run in dry-run mode.
**Then**: Policy scripts under `security/policy/` and shields scripts under `security/shields/` execute without generic placeholder aliases.

**Validation Steps**:
1. **Setup**: Bash: seed dry-run context.
2. **Execute**: Bash: run `run-suites.sh security-policy security-shields`.
3. **Verify**: Vitest/Bash: assert focused script paths and expected stable IDs.

**Tools Required**: Bash, Vitest

### Scenario 3.2: Gateway health broken state is not reported as success [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Sad Path

**Given**: A fixture or context representing a broken gateway/upstream state.
**When**: Gateway health honesty validation runs.
**Then**: The assertion fails or is explicitly deferred with runner requirements; it is not silently marked successful.

**Validation Steps**:
1. **Setup**: Bash/Vitest: seed broken gateway fixture or inspect parity metadata if live validation is deferred.
2. **Execute**: Vitest/Bash: run gateway health helper or parity-map validation.
3. **Verify**: Vitest: assert failure/deferred metadata includes `runner_requirement`.

**Tools Required**: Bash, Vitest

## Phase 4: Injection and OpenShell Version Coverage Migration - Validation Scenarios

### Scenario 4.1: Injection suite treats message payloads as data [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Sad Path

**Given**: A Telegram/message payload fixture containing shell syntax and a temp marker-file path.
**When**: The `security-injection` dry-run or fixture-mode suite evaluates the payload.
**Then**: No marker file or command side effect is created, and the assertion is mapped or deferred with secret requirements.

**Validation Steps**:
1. **Setup**: Bash: create payload fixture and temp marker path.
2. **Execute**: Bash/Vitest: run `run-suites.sh security-injection` in dry-run/fixture mode.
3. **Verify**: Bash/Vitest: assert marker file is absent and metadata includes stable ID or `secret_requirement`.

**Tools Required**: Bash, Vitest

### Scenario 4.2: OpenShell version capability is classified [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Happy Path

**Given**: The parity map includes `test-openshell-version-pin.sh` assertions.
**When**: Parity-map validation runs.
**Then**: Version/capability assertions are mapped to stable IDs or deferred with runner/capability requirements.

**Validation Steps**:
1. **Setup**: None.
2. **Execute**: `npm test -- test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`.
3. **Verify**: Vitest: assert required status and metadata.

**Tools Required**: Vitest

## Phase 5: Parity Review and Coverage Report Gate - Validation Scenarios

### Scenario 5.1: Eight-script legacy area reaches full classification [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Happy Path

**Given**: The parity inventory and parity map include the eight legacy scripts from issue #3815.
**When**: Strict parity-map and coverage-report tests run.
**Then**: Every legacy assertion is mapped, deferred, or retired; no unclassified assertion remains.

**Validation Steps**:
1. **Setup**: None.
2. **Execute**: `npm test -- test/e2e/scenario-framework-tests/e2e-parity-map.test.ts test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`.
3. **Verify**: Vitest: assert zero unclassified assertions and visible security domains.

**Tools Required**: Vitest

### Scenario 5.2: Parity metadata rejects incomplete deferred/retired items [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Sad Path

**Given**: A fixture parity map entry marked `deferred` without runner/secret requirement or `retired` without reviewer metadata.
**When**: Parity-map schema validation runs.
**Then**: Validation fails and reports the missing metadata field.

**Validation Steps**:
1. **Setup**: Vitest: create temp fixture parity map.
2. **Execute**: Vitest/tsx: run parity-map checker.
3. **Verify**: Vitest: assert non-zero status and missing-field message.

**Tools Required**: Vitest, tsx

## Phase 6: Clean the House - Validation Scenarios

### Scenario 6.1: Affected scenarios remain plan-only compatible [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Happy Path

**Given**: Affected scenario IDs are registered in `scenarios.yaml`.
**When**: `test/e2e/runtime/run-scenario.sh <id> --plan-only` runs for affected scenarios.
**Then**: Each command exits 0, prints the planned layers/suites, and does not contact live infrastructure.

**Validation Steps**:
1. **Setup**: None.
2. **Execute**: Bash: run plan-only for affected scenario IDs.
3. **Verify**: Bash/Vitest: assert exit 0 and no live side-effect markers.

**Tools Required**: Bash

### Scenario 6.2: New suite scripts pass hygiene checks [STATUS: passed] [VALIDATED: 1e4fa4a00]
**Type**: Sad Path

**Given**: New shell scripts under `test/e2e/validation_suites/security/` and the domain helper.
**When**: Convention lint and metadata hygiene tests run.
**Then**: Missing SPDX headers, missing executable bits, temporary files, or leftover TODOs fail the checks.

**Validation Steps**:
1. **Setup**: None.
2. **Execute**: `npm test -- test/e2e/scenario-framework-tests/e2e-convention-lint.test.ts test/e2e/scenario-framework-tests/e2e-metadata-final-hygiene.test.ts`.
3. **Verify**: Vitest: assert all hygiene checks pass.

**Tools Required**: Vitest

## Summary

| Phase | Happy | Sad | Total | Passed | Failed | Pending |
|-------|-------|-----|-------|--------|--------|---------|
| Phase 1 | 1 | 1 | 2 | 2 | 0 | 0 |
| Phase 2 | 1 | 1 | 2 | 2 | 0 | 0 |
| Phase 3 | 1 | 1 | 2 | 2 | 0 | 0 |
| Phase 4 | 1 | 1 | 2 | 2 | 0 | 0 |
| Phase 5 | 1 | 1 | 2 | 2 | 0 | 0 |
| Phase 6 | 1 | 1 | 2 | 2 | 0 | 0 |
| **Total** | **6** | **6** | **12** | **12** | **0** | **0** |

## Approval Status

**Status**: VALIDATED
