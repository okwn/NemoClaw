# Validation Plan: Inference Routing and Provider E2E Scenario Migration

Generated from: `specs/2026-05-20_inference-routing-provider-coverage/spec.md`
Test Spec: `specs/2026-05-20_inference-routing-provider-coverage/tests.md`

## Overview

**Feature**: Migrate inference-routing and provider E2E coverage into NemoClaw's layered scenario framework with stable assertion IDs and complete parity classification.

**Available Tools**: Bash, npm/Vitest, scenario framework runner, YAML parity-map tests, optional Docker/OpenShell/provider credentials for live validation.

## Coverage Summary

- Happy Paths: 6 scenarios
- Sad Paths: 5 scenarios
- Total: 11 scenarios

---

## Phase 1: Coverage Inventory and Parity Baseline - Validation Scenarios

### Scenario 1.1: Target legacy scripts are fully inventoried [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Happy Path

**Given**: The five issue #3812 legacy scripts exist in `test/e2e/`
**When**: The parity-map and legacy assertion inventory tests run
**Then**: Every target script has explicit assertion inventory and migration status metadata

**Validation Steps**:
1. **Setup**: Bash: confirm target script paths exist.
2. **Execute**: npm: `npm test -- test/e2e/scenario-framework-tests/e2e-legacy-assertion-inventory.test.ts test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
3. **Verify**: Bash/npm output shows no unknown or omitted target assertions.

**Tools Required**: Bash, npm/Vitest

### Scenario 1.2: Unknown parity status is rejected [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Sad Path

**Given**: A target legacy assertion lacks mapped/covered/deferred/retired classification
**When**: Parity-map validation runs
**Then**: Validation fails with the script and assertion context

**Validation Steps**:
1. **Setup**: Review or fixture invalid parity-map entry in the existing test pattern.
2. **Execute**: npm: `npm test -- test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
3. **Verify**: Test suite enforces no unknown target assertion statuses.

**Tools Required**: npm/Vitest

## Phase 2: Inference Routing Primitive Library - Validation Scenarios

### Scenario 2.1: Helper library is sourceable and plan-only safe [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Happy Path

**Given**: `test/e2e/validation_suites/lib/inference_routing.sh` exists
**When**: It is sourced under `set -euo pipefail` and used by plan-only suite execution
**Then**: It loads successfully and emits intended checks without live infrastructure

**Validation Steps**:
1. **Setup**: Bash: create fake context directory as required by existing helper tests.
2. **Execute**: npm: `npm test -- test/e2e/scenario-framework-tests/e2e-lib-helpers.test.ts test/e2e/scenario-framework-tests/e2e-convention-lint.test.ts`
3. **Verify**: Sourceability, naming, strict shell mode, and plan-only behavior pass.

**Tools Required**: Bash, npm/Vitest

### Scenario 2.2: Missing required context fails clearly [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Sad Path

**Given**: Required context keys are absent from `$E2E_CONTEXT_DIR/context.env`
**When**: An inference helper requiring that context is invoked
**Then**: The helper exits non-zero and names the missing context requirement

**Validation Steps**:
1. **Setup**: Bash/test fixture: create incomplete fake context.
2. **Execute**: npm: run helper/convention tests covering missing context.
3. **Verify**: Failure output is bounded and actionable.

**Tools Required**: Bash, npm/Vitest

### Scenario 2.3: Secrets are not printed by inference helpers [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Sad Path

**Given**: Fake provider token/API key values exist in context
**When**: Helper-backed checks run or fail
**Then**: Output redacts or omits the raw secret values

**Validation Steps**:
1. **Setup**: Bash/test fixture: inject fake secret values.
2. **Execute**: npm: run helper/convention tests.
3. **Verify**: Search captured output for fake secret; it must not appear.

**Tools Required**: Bash, npm/Vitest

## Phase 3: Domain Suite Migration - Validation Scenarios

### Scenario 3.1: Domain suite families resolve to inference-specific steps [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Happy Path

**Given**: `suites.yaml` contains affected inference/provider suite families
**When**: Scenario resolver and suite-runner tests run
**Then**: Families resolve to domain-specific `validation_suites/inference/**` steps where behavior differs from generic smoke checks

**Validation Steps**:
1. **Setup**: Bash: inspect changed `suites.yaml` and affected suite files.
2. **Execute**: npm: `npm test -- test/e2e/scenario-framework-tests/e2e-scenario-resolver.test.ts test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
3. **Verify**: Resolver output includes new domain steps and expected assertion IDs.

**Tools Required**: Bash, npm/Vitest

### Scenario 3.2: Affected scenarios support plan-only execution [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Happy Path

**Given**: Final affected scenario IDs are known
**When**: `bash test/e2e/runtime/run-scenario.sh <scenario-id> --plan-only` runs for each
**Then**: Each exits 0 and lists the expected inference/provider checks

**Validation Steps**:
1. **Setup**: Bash: list affected scenario IDs from scenario definitions.
2. **Execute**: Bash: run plan-only for each affected ID.
3. **Verify**: Output includes stable `post-onboard.<domain>.<behavior>` assertion IDs.

**Tools Required**: Bash, scenario framework runner

### Scenario 3.3: Unsupported live runner requirements do not break static validation [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Sad Path

**Given**: Provider credentials, Docker/OpenShell, or local Ollama runner are unavailable
**When**: Static tests and plan-only checks run
**Then**: Static validation still passes, and unavailable live requirements are represented in parity metadata rather than causing false failures

**Validation Steps**:
1. **Setup**: Bash: run without live provider secret exports.
2. **Execute**: npm/Bash: run static framework tests and plan-only scenarios.
3. **Verify**: Tests pass; live-only requirements are deferred/metadata-scoped.

**Tools Required**: Bash, npm/Vitest

## Phase 4: Parity Map and Coverage Report Completion - Validation Scenarios

### Scenario 4.1: Coverage report exposes issue #3812 domains [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Happy Path

**Given**: All target assertions are classified in `parity-map.yaml`
**When**: Coverage report tests run
**Then**: Inference routing/provider coverage appears explicitly with migrated/covered/deferred/retired counts

**Validation Steps**:
1. **Setup**: Bash: confirm parity-map entries include required metadata.
2. **Execute**: npm: `npm test -- test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
3. **Verify**: No target-script assertion is unknown; report includes the domain.

**Tools Required**: Bash, npm/Vitest

### Scenario 4.2: Incomplete deferred/retired metadata is rejected [STATUS: passed] [VALIDATED: a6d4d39f2]
**Type**: Sad Path

**Given**: A deferred or retired target assertion lacks owner, runner/secret requirements, reason, or reviewer metadata as applicable
**When**: Parity-map validation runs
**Then**: Validation fails with the incomplete assertion context

**Validation Steps**:
1. **Setup**: Existing negative fixture or test case for incomplete metadata.
2. **Execute**: npm: `npm test -- test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
3. **Verify**: Validation enforces metadata hygiene.

**Tools Required**: npm/Vitest

## Phase 5: PR Validation and Live-Capable Verification - Validation Scenarios

### Scenario 5.1: PR evidence includes static, plan-only, and parity results [STATUS: blocked]
**Type**: Happy Path

**Given**: Implementation is complete and a PR is opened for issue #3812
**When**: The PR description and branch test output are reviewed
**Then**: The PR includes static scenario-framework results, plan-only results, parity review result, and notes for any unavailable live runs

**Validation Steps**:
1. **Setup**: Bash/gh: identify PR number and final changed files.
2. **Execute**: npm/Bash: run minimum expected test commands and plan-only checks.
3. **Verify**: PR description records commands/results and deferred live requirements when applicable.

**Tools Required**: Bash, npm/Vitest, gh CLI

## Summary

| Phase | Happy | Sad | Total | Passed | Failed | Pending | Blocked |
|-------|-------|-----|-------|--------|--------|---------|---------|
| Phase 1 | 1 | 1 | 2 | 2 | 0 | 0 | 0 |
| Phase 2 | 1 | 2 | 3 | 3 | 0 | 0 | 0 |
| Phase 3 | 2 | 1 | 3 | 3 | 0 | 0 | 0 |
| Phase 4 | 1 | 1 | 2 | 2 | 0 | 0 | 0 |
| Phase 5 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| **Total** | **6** | **5** | **11** | **10** | **0** | **0** | **1** |
