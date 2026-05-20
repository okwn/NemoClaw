# Test Specification: Security Policy and Credential E2E Migration

Generated from: `specs/2026-05-20_security_policy_credentials_e2e_migration/spec.md`

## Test Strategy

Use the existing Vitest scenario-framework tests plus shell dry-run checks. Tests should validate scenario metadata, suite wiring, helper behavior, and parity-map classification without contacting live infrastructure unless a scenario is explicitly marked as requiring a live runner or secrets.

### Phase 1: Coverage Inventory and Primitive Contract - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-legacy-assertion-inventory.test.ts`
  - Verify the eight legacy scripts are present in the inventory input for this migration.
- `test/e2e/scenario-framework-tests/e2e-lib-helpers.test.ts`
  - Add coverage for loading `validation_suites/lib/security_policy_credentials.sh`.

**New Tests to Create:**
1. `security_policy_credentials_helper_should_load_with_context_library`
   - **Input**: Bash shell sourcing the helper with a temp `E2E_CONTEXT_DIR/context.env`.
   - **Expected**: Helper loads successfully and can read required context through `runtime/lib/context.sh` helpers.
   - **Covers**: Primitive library exists and uses context helpers.
2. `security_policy_credentials_helper_should_fail_when_required_context_missing`
   - **Input**: Missing required keys in `context.env`.
   - **Expected**: Clear non-zero failure naming the missing key; no setup rediscovery occurs.
   - **Covers**: Context contract and no independent setup discovery.
3. `security_policy_credentials_helper_should_not_log_secret_values`
   - **Input**: Context and fixture output containing credential-shaped values.
   - **Expected**: Logs include provider/name metadata only and redact raw values.
   - **Covers**: No credential value logging.

**Test Implementation Notes:**
- Prefer temp directories and `E2E_DRY_RUN=1`.
- Avoid real gateway, sandbox, messaging, or secrets.

### Phase 2: Credential and Sanitization Suite Migration - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
  - Assert `security-credentials` resolves to credential-specific scripts and succeeds in dry-run/plan-only mode.
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
  - Assert `test-credential-migration.sh` and `test-credential-sanitization.sh` entries contain mapped/deferred/retired assertions with required metadata.

**New Tests to Create:**
1. `security_credentials_suite_should_not_use_generic_aliases`
   - **Input**: `test/e2e/validation_suites/suites.yaml`.
   - **Expected**: `security-credentials` steps are explicit YAML entries pointing under `security/credentials/` and not generic `assert/no-credentials-leaked.sh` aliases only.
   - **Covers**: Focused suite wiring without introducing a second suite discovery mechanism.
2. `security_credentials_suite_should_emit_stable_assertion_ids`
   - **Input**: Dry-run execution of `security-credentials` through `test/e2e/runtime/run-suites.sh` with a temp context.
   - **Expected**: Output or metadata includes IDs such as `post-onboard.credentials.gateway-list-redacts-values`; no glob-only step references are required because suites use explicit `suites.yaml` step lists.
   - **Covers**: Stable assertion IDs and existing suite-runner compatibility.
3. `credential_parity_entries_should_have_layer_domain_owner_metadata`
   - **Input**: `test/e2e/docs/parity-map.yaml`.
   - **Expected**: All credential migration/sanitization assertions are `mapped`, `deferred`, or `retired` and include `layer`, `gap_domain`, and `owner` as applicable.
   - **Covers**: 100% classification contract.

### Phase 3: Security Policy, Shields, and Gateway Health Migration - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
  - Add dry-run suite checks for `security-policy` and `security-shields`.
- `test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`
  - Assert policy, shields, and gateway health domains appear as covered/deferred/retired in coverage output.

**New Tests to Create:**
1. `security_policy_suite_should_use_focused_policy_scripts`
   - **Input**: `suites.yaml`.
   - **Expected**: `security-policy` steps point under `security/policy/`.
   - **Covers**: Policy suite wiring.
2. `security_shields_suite_should_use_focused_shields_scripts`
   - **Input**: `suites.yaml`.
   - **Expected**: `security-shields` steps point under `security/shields/`.
   - **Covers**: Shields suite wiring.
3. `gateway_health_honesty_should_be_mapped_or_deferred_with_runner_requirement`
   - **Input**: `parity-map.yaml`.
   - **Expected**: Gateway health/drift assertions are mapped to stable IDs or deferred with `runner_requirement`.
   - **Covers**: Gateway health honesty classification.

### Phase 4: Injection and OpenShell Version Coverage Migration - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
  - Add dry-run suite check for `security-injection`.
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
  - Verify messaging secret and gateway capability metadata for deferred items.

**New Tests to Create:**
1. `security_injection_suite_should_use_focused_injection_scripts`
   - **Input**: `suites.yaml`.
   - **Expected**: `security-injection` steps point under `security/injection/`.
   - **Covers**: Injection suite wiring.
2. `telegram_injection_assertion_should_not_execute_payload_in_dry_run`
   - **Input**: Dry-run execution with a shell-like message payload fixture.
   - **Expected**: Payload is treated as data; no marker file/side effect is created.
   - **Covers**: Injection-sensitive behavior.
3. `openshell_version_pin_should_be_mapped_or_deferred_with_capability_metadata`
   - **Input**: `parity-map.yaml`.
   - **Expected**: Version/capability assertions are mapped or deferred with runner/capability requirements.
   - **Covers**: Version pin coverage.

### Phase 5: Parity Review and Coverage Report Gate - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
  - Add strict-mode coverage for the eight-script migration set.
- `test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`
  - Confirm the security-policy/credential domain summary has no unclassified assertions.

**New Tests to Create:**
1. `security_policy_credentials_legacy_area_should_have_no_unclassified_assertions`
   - **Input**: Inventory and `parity-map.yaml`.
   - **Expected**: Every assertion from the eight legacy scripts is mapped, deferred, or retired.
   - **Covers**: 100%+ parity gate.
2. `coverage_report_should_surface_security_domains`
   - **Input**: Coverage report generator output.
   - **Expected**: Credential, policy, shields, injection, and gateway domains are visible with mapped/deferred/retired counts.
   - **Covers**: Report visibility.

### Phase 6: Clean the House - Test Guide

**Existing Tests to Modify:**
- `test/e2e/scenario-framework-tests/e2e-convention-lint.test.ts`
  - Include new suite scripts in executable-bit, SPDX, and no-temporary-artifact checks.
- `test/e2e/scenario-framework-tests/e2e-metadata-final-hygiene.test.ts`
  - Verify no migration TODOs remain in final metadata.

**New Tests to Create:**
1. `new_security_suite_scripts_should_have_spdx_and_executable_bits`
   - **Input**: Files under `test/e2e/validation_suites/security/` and the domain helper.
   - **Expected**: SPDX headers are present; executable suite scripts have executable bits.
   - **Covers**: Final hygiene.
2. `affected_scenarios_should_support_plan_only`
   - **Input**: `test/e2e/runtime/run-scenario.sh <affected-id> --plan-only`.
   - **Expected**: Plan-only exits 0 and does not contact live infrastructure.
   - **Covers**: Compatibility requirement.

## Suggested Test Commands

- `npm test -- test/e2e/scenario-framework-tests/e2e-suite-runner.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-parity-map.test.ts`
- `npm test -- test/e2e/scenario-framework-tests/e2e-coverage-report.test.ts`
- `bash test/e2e/runtime/run-scenario.sh <affected-scenario-id> --plan-only`
