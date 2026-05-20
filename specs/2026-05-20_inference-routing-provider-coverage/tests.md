# Test Specification: Inference Routing and Provider E2E Scenario Migration

Generated from: `specs/2026-05-20_inference-routing-provider-coverage/spec.md`

## Test Strategy

Use TDD around the existing scenario framework tests. Prefer static and plan-only tests over live provider calls. Live execution is validation evidence, not required for unit/static gates unless credentials and runners are available.

## Phase 1: Coverage Inventory and Parity Baseline - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-legacy-assertion-inventory.test.ts`
  - Verify each target legacy script can be inventoried.
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
  - Verify every inventoried assertion has a mapped, covered, deferred, or retired outcome.

**New Tests to Create:**
1. `test_should_include_all_issue_3812_target_scripts_in_parity_map`
   - **Input**: `parity-map.yaml` entries for the five target scripts.
   - **Expected**: No target script missing from the map; include `test-inference-routing.sh`, `test-openclaw-inference-switch.sh`, `test-kimi-inference-compat.sh`, `test-ollama-auth-proxy-e2e.sh`, and `test-model-router-provider-routed-inference.sh` literally in the assertion fixture.
   - **Covers**: Phase 1 acceptance criteria.
2. `test_should_reject_unknown_target_assertion_status`
   - **Input**: Target assertion with missing or invalid status.
   - **Expected**: Static parity-map test fails with script/assertion context.
   - **Covers**: No silent drops.

**Test Implementation Notes:**
- Keep inventory tests deterministic; do not execute legacy scripts.
- Use existing YAML parsing and fixture patterns in scenario-framework tests.
- When adding negative fixtures, keep them in test-local temporary data or inline objects so they cannot be mistaken for real parity metadata.

## Phase 2: Inference Routing Primitive Library - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-lib-helpers.test.ts`
  - Add `inference_routing.sh` sourceability checks using the same strict-shell subprocess pattern as existing helper tests.
- `test/e2e/scenario-framework-tests/e2e-convention-lint.test.ts`
  - Ensure helper naming, assertion IDs, dry-run handling, bounded `curl --max-time`, and shell conventions pass.

**New Tests to Create:**
1. `test_should_source_inference_routing_helpers_under_strict_shell_mode`
   - **Input**: Shell snippet with `set -euo pipefail` sourcing the helper.
   - **Expected**: Source succeeds without required live context.
   - **Covers**: Library sourceability.
2. `test_should_fail_clearly_when_required_context_is_missing`
   - **Input**: Helper invocation without required context keys.
   - **Expected**: Non-zero exit and message naming missing context.
   - **Covers**: Explicit context requirements.
3. `test_should_emit_plan_only_checks_without_live_infrastructure`
   - **Input**: Plan-only execution of a helper-backed suite.
   - **Expected**: Intended assertion/check is printed; no network call required.
   - **Covers**: Dry-run behavior.
4. `test_should_not_print_secret_values_in_helper_output`
   - **Input**: Context containing fake token/API key.
   - **Expected**: Output omits or redacts secret value.
   - **Covers**: Credential hygiene.

**Test Implementation Notes:**
- Use fake context directories and shell subprocess tests already used by framework tests.
- Assert command timeouts or bounded flags by inspecting scripts where practical.
- Assert helper output includes stable assertion IDs but never includes fake values assigned to `*TOKEN*`, `*API_KEY*`, `*SECRET*`, or `*CREDENTIAL*` context keys.

## Phase 3: Domain Suite Migration - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-scenario-resolver.test.ts`
  - Confirm affected scenarios resolve new domain-specific suite steps.
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
  - Confirm plan-only execution includes new inference suites.
- `test/e2e/scenario-framework-tests/e2e-scenario-schema.test.ts`
  - Update only if new suite names require schema awareness.
- `test/e2e/scenario-framework-tests/e2e-scenario-additional-families.test.ts`
  - Prefer this existing family-coverage test for assertions that suite families such as `inference-routing`, `inference-switch`, `kimi-compatibility`, `ollama-auth-proxy`, and `model-router` resolve to domain-specific steps.

**New Tests to Create:**
1. `test_should_route_inference_suite_families_to_domain_specific_steps`
   - **Input**: `suites.yaml` families for inference-routing, inference-switch, Kimi, Ollama auth proxy, model-router.
   - **Expected**: Families point to `validation_suites/inference/**` steps, not generic aliases where behavior differs.
   - **Covers**: Suite organization.
2. `test_should_emit_stable_assertion_ids_for_migrated_inference_behaviors`
   - **Input**: Plan-only output for affected scenario families.
   - **Expected**: Expected `post-onboard.<domain>.<behavior>` IDs appear.
   - **Covers**: Stable assertion ID strategy.
3. `test_should_preserve_plan_only_execution_for_new_domain_suites`
   - **Input**: `run-scenario.sh <scenario-id> --plan-only`.
   - **Expected**: Exit 0 with listed inference checks.
   - **Covers**: Plan-only compatibility.

**Test Implementation Notes:**
- Avoid live inference in static tests.
- Add scenario IDs to fixtures only when needed by existing resolver patterns.
- Verify `suites.yaml` edits directly where possible instead of creating duplicate fixture-only suite definitions.

## Phase 4: Parity Map and Coverage Report Completion - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
  - Validate issue #3812 metadata: `layer`, `gap_domain`, `owner`, runner requirements, secret requirements.
- `test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`
  - Verify inference/provider coverage appears in generated coverage output.

**New Tests to Create:**
1. `test_should_require_metadata_for_deferred_target_assertions`
   - **Input**: Deferred target assertion without owner or runner/secret metadata.
   - **Expected**: Parity-map validation fails.
   - **Covers**: Deferred metadata completeness.
2. `test_should_require_retirement_reason_for_retired_target_assertions`
   - **Input**: Retired target assertion without reason/reviewer metadata.
   - **Expected**: Parity-map validation fails.
   - **Covers**: Retired classification hygiene.
3. `test_should_report_issue_3812_domain_coverage_summary`
   - **Input**: Coverage report generation.
   - **Expected**: Inference routing/provider domains appear with migrated/covered/deferred/retired counts.
   - **Covers**: Visible parity completion.

**Test Implementation Notes:**
- Tests should fail if any target assertion is unknown or omitted.
- Do not require live provider credentials for coverage-report tests.
- Include a count-based assertion for each of the five target scripts so one large script cannot mask an omitted smaller script.

## Phase 5: PR Validation and Live-Capable Verification - Test Guide

**Existing Tests to Run:**
- `npm test -- test/e2e/scenario-framework-tests/e2e-legacy-assertion-inventory.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-lib-helpers.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-scenario-resolver.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-scenario-schema.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-convention-lint.test.ts`

**New Tests to Create:**
- None required unless implementation adds new schema/convention rules.

**Validation Notes:**
- Run plan-only checks for final affected scenario IDs.
- Run live scenarios only when Docker/OpenShell/provider credentials/local runners are available.
- PR evidence must include static test results, plan-only results, parity outcome, and any intentionally unavailable live runs.
