# Test Specification: Messaging Provider Scenario Suite Migration

Generated from: `specs/2026-05-20_messaging-provider-scenario-migration/spec.md`

## Test Strategy

Use TDD around the existing scenario framework tests in `test/e2e/scenario-framework-tests/`. Local tests must not require Docker, OpenShell, live provider tokens, or cloud credentials. Live behavior is validated through plan-only scenario runs and optional documented live runs.

## Phase 1: Messaging Primitive Library - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-lib-helpers.test.ts`
  - Add shell-helper coverage for `validation_suites/lib/messaging_providers.sh`.

**New Tests to Create:**
1. `test_should_source_messaging_provider_library_in_isolation`
   - **Input**: Source the helper library in a clean shell.
   - **Expected**: Shell exits 0 without requiring live context until a context-dependent function is invoked.
   - **Covers**: Helper library can be sourced in isolation and safely reuses existing runtime helpers.
2. `test_should_fail_with_clear_diagnostic_when_context_missing`
   - **Input**: Invoke context loader without `$E2E_CONTEXT_DIR/context.env`.
   - **Expected**: Non-zero exit and diagnostic naming `E2E_CONTEXT_DIR` or `context.env`.
   - **Covers**: Missing context fails clearly.
3. `test_should_derive_provider_names_for_messaging_channels`
   - **Input**: Telegram, Discord, Slack bot/app, WhatsApp QR-only fixture contexts.
   - **Expected**: Expected OpenShell provider/channel names are returned.
   - **Covers**: Provider-name derivation acceptance criteria.
4. `test_should_resolve_agent_config_paths`
   - **Input**: OpenClaw and Hermes context fixtures.
   - **Expected**: `/sandbox/.openclaw/openclaw.json` and `/sandbox/.hermes/.env` are selected.
   - **Covers**: Agent config helper behavior.
5. `test_should_expose_placeholder_and_secret_leak_interfaces_without_live_secrets`
   - **Input**: Mock config/env/process text.
   - **Expected**: Placeholder config passes; raw token strings fail.
   - **Covers**: Placeholder wiring and no-secret-leak helper contracts.

**Test Implementation Notes:**
- Use temporary directories for context fixtures.
- Execute helpers via `bash -c` from Vitest.
- Reuse the existing `runBash` helper pattern and runtime `context.sh` expectations already present in `e2e-lib-helpers.test.ts`.
- Keep fixtures synthetic and deterministic.

## Phase 2: Provider Expected-State Suites - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
- `test/e2e/scenario-framework-tests/e2e-scenario-schema.test.ts`
- `test/e2e/scenario-framework-tests/e2e-scenario-resolver.test.ts`
- `test/e2e/scenario-framework-tests/e2e-scenarios-workflow.test.ts`

**New Tests to Create:**
1. `test_should_define_real_steps_for_messaging_provider_suites`
   - **Input**: `validation_suites/suites.yaml`.
   - **Expected**: `messaging-telegram`, `messaging-discord`, and `messaging-slack` reference messaging-specific scripts, not generic smoke aliases.
   - **Covers**: Suite aliases replaced with real checks.
2. `test_should_wire_messaging_suites_to_existing_messaging_scenarios`
   - **Input**: `nemoclaw_scenarios/scenarios.yaml` and generated context from `emit-context-from-plan.sh`.
   - **Expected**: All listed Telegram/Discord/Slack OpenClaw and Hermes scenarios include matching suite IDs, and messaging plans emit normalized `E2E_*` context keys required by the suites.
   - **Covers**: Scenario YAML changes and context emission.
3. `test_should_accept_stable_messaging_assertion_ids`
   - **Input**: New suite metadata/assertion output fixtures or dry-run output from messaging scripts.
   - **Expected**: IDs follow `<layer>.<domain>.<behavior>` and use approved messaging/security domains in existing `PASS:` / `FAIL:` output.
   - **Covers**: Stable assertion ID convention without introducing a parallel result format.
4. `test_should_plan_only_each_affected_provider_scenario`
   - **Input**: Affected scenario IDs with `run-scenario.sh <id> --plan-only`.
   - **Expected**: Each plan-only run exits 0.
   - **Covers**: Plan-only compatibility.

**Test Implementation Notes:**
- Plan-only tests may be shell-driven and should not require secrets.
- Add skip/fail-clear assertions for absent live context at suite-script level.
- Assert that only wired suite scripts are required to exist; deferred lifecycle and compatible-endpoint gaps belong in parity metadata until scenario state is available.
- Use `E2E_*` context names in tests and fixtures; avoid introducing new `NEMOCLAW_*` aliases.

## Phase 3: Token Rotation and Channel Lifecycle Suites - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`

**New Tests to Create:**
1. `test_should_define_real_steps_for_messaging_token_rotation_suite`
   - **Input**: `suites.yaml`.
   - **Expected**: `messaging-token-rotation` points to token-rotation scripts, not smoke steps.
   - **Covers**: Token rotation suite has real validation steps.
2. `test_should_detect_only_rotated_provider_signal`
   - **Input**: Mock rotation metadata/log fixtures for Telegram, Discord, and Slack.
   - **Expected**: Only the rotated provider assertion passes; unrelated providers are not marked rotated.
   - **Covers**: No cross-talk acceptance criteria.
3. `test_should_classify_unsupported_lifecycle_matrix_cases_as_deferred`
   - **Input**: `parity-map.yaml` lifecycle entries.
   - **Expected**: Orchestration-heavy cases include `deferred`, runner/context requirements, and reason.
   - **Covers**: Deferred unsupported lifecycle coverage.

**Test Implementation Notes:**
- Do not embed stop/start orchestration in unit tests; validate state interpretation and parity metadata.

## Phase 4: Security and Compatible Endpoint Assertions - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
- `test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`

**New Tests to Create:**
1. `test_should_include_telegram_injection_safety_assertion_ids`
   - **Input**: Suite definitions and/or assertion fixtures.
   - **Expected**: Command substitution, backtick, variable expansion, and shell metacharacter payload classes have stable IDs where implemented.
   - **Covers**: High-risk injection assertions.
2. `test_should_map_or_defer_compatible_endpoint_assertions`
   - **Input**: `parity-map.yaml` entries for `test-messaging-compatible-endpoint.sh`.
   - **Expected**: Each assertion is mapped or deferred with runner/fixture requirements.
   - **Covers**: Compatible endpoint treatment.
3. `test_should_not_count_brave_search_as_messaging_provider_coverage`
   - **Input**: `parity-map.yaml` and coverage report output.
   - **Expected**: Brave entries use `post-onboard.web-search.brave.*` or equivalent web-search domain, not messaging-provider coverage.
   - **Covers**: Brave classification acceptance criteria.

**Test Implementation Notes:**
- Injection tests should validate payload handling in scripts/fixtures locally; live provider execution remains optional validation.

## Phase 5: Parity Map and Coverage Report Integration - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
- `test/e2e/scenario-framework-tests/e2e-legacy-assertion-inventory.test.ts`
- `test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`

**New Tests to Create:**
1. `test_should_classify_all_issue_3810_legacy_assertions`
   - **Input**: `parity-map.yaml` entries for all six legacy scripts.
   - **Expected**: No relevant legacy assertion remains unclassified.
   - **Covers**: Full classification acceptance criteria.
2. `test_should_require_metadata_for_mapped_deferred_and_retired_entries`
   - **Input**: Messaging parity entries.
   - **Expected**: `layer`, `gap_domain`, `owner`, runner/secret requirements where applicable, and reasons for deferred/retired statuses are present.
   - **Covers**: Metadata requirements.
3. `test_should_report_messaging_provider_coverage_status`
   - **Input**: Coverage report command output.
   - **Expected**: Messaging provider coverage is visible as covered, deferred, or retired.
   - **Covers**: Coverage report integration.

**Test Implementation Notes:**
- Prefer schema/metadata assertions over brittle exact coverage percentages unless the existing report already exposes stable totals.

## Phase 6: Scenario Framework Validation - Test Guide

**Existing Tests to Modify:**
- All affected `test/e2e/scenario-framework-tests/*` that validate schemas, resolver, runner, parity map, coverage report, helper behavior, and metadata hygiene.

**New Tests to Create:**
1. `test_should_pass_local_scenario_framework_suite`
   - **Input**: Project test command for scenario framework tests.
   - **Expected**: All local framework tests pass.
   - **Covers**: Full local validation acceptance criteria.
2. `test_should_plan_only_all_affected_messaging_scenarios`
   - **Input**: Affected scenario IDs.
   - **Expected**: `run-scenario.sh <id> --plan-only` exits 0 for each.
   - **Covers**: Plan-only compatibility.
3. `test_should_document_live_validation_status`
   - **Input**: Validation notes or PR checklist.
   - **Expected**: Representative live provider/token-rotation runs are either passed or skipped with exact missing runner/secret requirements.
   - **Covers**: Live validation documentation.

**Test Implementation Notes:**
- Required final validation includes PR creation with added tests passing and a re-review showing existing legacy onboarding E2E coverage has 100% or greater parity.
