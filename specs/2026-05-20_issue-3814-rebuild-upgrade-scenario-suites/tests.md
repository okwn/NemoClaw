<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Test Specification: Issue #3814 — Rebuild/Upgrade Scenario Suite Migration

## Test Strategy

Use scenario-framework tests for schema, suite resolution, helper behavior, parity-map validation, and coverage reporting. Avoid live rebuild/upgrade execution in unit-style tests; use fake context directories, fake command shims, and dry-run/plan-only validation.

Primary existing test locations:

- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
- `test/e2e/scenario-framework-tests/e2e-lib-helpers.test.ts`
- `test/e2e/scenario-framework-tests/e2e-legacy-assertion-inventory.test.ts`
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
- `test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`
- `test/e2e/scenario-framework-tests/e2e-scenarios-workflow.test.ts`

Suggested new or expanded tests:

- `test/e2e/scenario-framework-tests/e2e-rebuild-upgrade-suite.test.ts`
- Expand `e2e-parity-map.test.ts` and `e2e-coverage-report.test.ts` where existing coverage already owns the behavior.

---

## Phase 1: Legacy Assertion Inventory and Parity Baseline - Test Guide

**Existing Tests to Modify:**

- `e2e-legacy-assertion-inventory.test.ts`
  - Current behavior: validates extracted legacy assertion inventory conventions.
  - Required changes: ensure the four rebuild/upgrade legacy scripts have reviewed assertion records or inventory entries.

**New Tests to Create:**

1. `test_should_include_rebuild_upgrade_legacy_scripts_in_inventory`
   - **Input**: generated or checked-in parity inventory.
   - **Expected**: entries exist for `test-rebuild-openclaw.sh`, `test-rebuild-hermes.sh`, `test-upgrade-stale-sandbox.sh`, and `test-openshell-gateway-upgrade.sh`.
   - **Covers**: Phase 1 baseline completeness.

2. `test_should_require_each_rebuild_upgrade_assertion_to_have_disposition`
   - **Input**: parity-map records for the four legacy scripts.
   - **Expected**: every relevant assertion is classified as `mapped`, `deferred`, or `retired`.
   - **Covers**: no unreviewed relevant legacy assertions.

**Test Implementation Notes:**

- Prefer extending parity-map tests if inventory validation is already centralized there.
- Do not assert exact final counts unless the inventory is stable and checked in.

---

## Phase 2: Rebuild/Upgrade Primitive Library - Test Guide

**Existing Tests to Modify:**

- `e2e-lib-helpers.test.ts`
  - Current behavior: validates helper library sourcing and shell helper conventions.
  - Required changes: include `lib/rebuild_upgrade.sh` in sourceability and side-effect checks.

**New Tests to Create or Add to Existing Helper Coverage:**

1. `test_should_source_rebuild_upgrade_library_without_side_effects`
   - **Input**: `bash -c 'source test/e2e/validation_suites/lib/rebuild_upgrade.sh'` with a clean environment.
   - **Expected**: exits successfully or with documented missing-dependency behavior; does not run rebuild, onboard, install, or network commands.
   - **Covers**: helper sourceability acceptance criterion.

2. `test_should_fail_with_clear_message_when_required_context_missing`
   - **Input**: call the helper context validation function without required `E2E_*` keys.
   - **Expected**: non-zero exit and message naming the missing key.
   - **Covers**: context-first behavior.

3. `test_should_validate_required_context_when_all_keys_present`
   - **Input**: fake `context.env` or exported `E2E_CONTEXT_DIR`, `E2E_SCENARIO`, `E2E_AGENT`, `E2E_SANDBOX_NAME`, and `E2E_GATEWAY_URL`.
   - **Expected**: validation succeeds.
   - **Covers**: success path.

4. `test_should_allow_command_fakes_for_reachability_version_and_inference_checks`
   - **Input**: PATH shim or helper override variables returning deterministic success/failure.
   - **Expected**: primitive functions report correct PASS/FAIL without real sandbox access.
   - **Covers**: mockable command boundary.

**Test Implementation Notes:**

- Add these cases to `e2e-lib-helpers.test.ts` unless the file becomes too large; prefer direct integration with existing helper tests over a parallel helper-test harness.
- Use temporary directories and fake executable shims.
- Validate no helper function installs, onboards, rebuilds, or rediscover hidden setup state.

---

## Phase 3: Scenario Suite Steps and Suite Metadata - Test Guide

**Existing Tests to Modify:**

- `e2e-suite-runner.test.ts`
  - Current behavior: validates suite runner behavior and suite metadata.
  - Required changes: assert `rebuild` and `upgrade` resolve to rebuild/upgrade-specific scripts rather than generic smoke-only steps.

**New Tests to Create or Add to Existing Suite Runner Coverage:**

1. `test_should_resolve_rebuild_suite_to_domain_specific_steps`
   - **Input**: `test/e2e/validation_suites/suites.yaml`.
   - **Expected**: `rebuild` contains scripts under the rebuild/upgrade domain and not only `smoke/*` scripts.
   - **Covers**: rebuild suite migration.

2. `test_should_resolve_upgrade_suite_to_domain_specific_steps`
   - **Input**: `suites.yaml`.
   - **Expected**: `upgrade` contains upgrade-specific scripts and not only generic smoke scripts.
   - **Covers**: upgrade suite migration.

3. `test_should_emit_stable_rebuild_upgrade_assertion_ids`
   - **Input**: run suite scripts with fake context and command shims.
   - **Expected**: output includes IDs such as `suite.rebuild.workspace_state_preserved` and `suite.upgrade.survivor_agent_reachable` for implemented checks.
   - **Covers**: stable assertion ID plan.

4. `test_should_keep_suite_scripts_executable_and_shellcheck_compatible`
   - **Input**: new suite script files.
   - **Expected**: executable bit set; shell syntax check passes.
   - **Covers**: script hygiene.

5. `test_should_preserve_plan_only_for_affected_scenarios`
   - **Input**: `bash test/e2e/runtime/run-scenario.sh <affected-id> --plan-only`.
   - **Expected**: exits 0 and renders plan without executing suite actions.
   - **Covers**: plan-only compatibility.

**Test Implementation Notes:**

- Add metadata resolution tests to `e2e-suite-runner.test.ts` when practical so suite parsing remains covered in one place.
- Select concrete affected scenario IDs during implementation after suite metadata is updated; record them in implementation notes or PR validation so this gate is reproducible.
- Use dry-run/fake context tests rather than live sandbox commands.

---

## Phase 4: Parity Map and Coverage Report Integration - Test Guide

**Existing Tests to Modify:**

- `e2e-parity-map.test.ts`
  - Current behavior: validates parity-map schema and status metadata.
  - Required changes: enforce rebuild/upgrade mapped/deferred/retired records.
- `e2e-coverage-report.test.ts`
  - Current behavior: validates coverage report generation and visibility.
  - Required changes: assert rebuild/upgrade domains appear in report output.

**New Tests to Create:**

1. `test_should_validate_rebuild_upgrade_parity_map_records`
   - **Input**: `test/e2e/docs/parity-map.yaml`.
   - **Expected**: records for the four legacy scripts pass schema and include required metadata.
   - **Covers**: parity-map acceptance criteria.

2. `test_should_reject_duplicate_assertion_ids_unless_reusable`
   - **Input**: parity-map records with stable IDs.
   - **Expected**: duplicates fail unless explicitly marked `reusable: true` according to schema.
   - **Covers**: stable ID uniqueness.

3. `test_should_show_rebuild_upgrade_counts_in_coverage_report`
   - **Input**: generated coverage report.
   - **Expected**: report includes mapped/deferred/retired counts for rebuild and upgrade domains.
   - **Covers**: coverage visibility.

**Test Implementation Notes:**

- Reuse existing parity checker command in tests where possible.
- Test both non-strict and strict modes if the existing suite supports both.

---

## Phase 5: PR Validation and 100%+ Parity Review - Test Guide

**Existing Tests to Modify:**

- No dedicated code test is required for PR creation. Validation evidence belongs in PR notes or implementation notes.

**New Tests to Create:**

1. `test_should_run_targeted_scenario_framework_tests`
   - **Input**: `npm test -- test/e2e/scenario-framework-tests` or the repo-supported targeted Vitest command.
   - **Expected**: passes locally.
   - **Covers**: added test pass gate.

2. `test_should_run_plan_only_for_recorded_rebuild_upgrade_scenarios`
   - **Input**: `bash test/e2e/runtime/run-scenario.sh <recorded-rebuild-id> --plan-only` and `bash test/e2e/runtime/run-scenario.sh <recorded-upgrade-id> --plan-only`.
   - **Expected**: both commands exit 0 and do not execute suite actions.
   - **Covers**: affected scenario compatibility gate.

3. `test_should_run_strict_parity_map_validation`
   - **Input**: `npx tsx scripts/e2e/check-parity-map.ts --root . --strict`.
   - **Expected**: exits 0.
   - **Covers**: parity gate.

4. `test_should_record_100_percent_or_greater_parity_review`
   - **Input**: PR body or implementation notes.
   - **Expected**: contains a validation note comparing migrated scenario assertions to reviewed legacy E2E coverage.
   - **Covers**: final parity acceptance criterion.

**Test Implementation Notes:**

- Local tests should not require secrets or live GPU instances.
- CI pass and PR body checks are manual/maintainer validation gates, not unit tests.
