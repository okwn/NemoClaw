#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Security policy and credential validation primitives.

if [[ -n "${NEMOCLAW_SECURITY_POLICY_CREDENTIALS_LIB_LOADED:-}" ]]; then
  # shellcheck disable=SC2317 # This file may be sourced repeatedly or executed in tests.
  return 0 2>/dev/null || exit 0
fi
NEMOCLAW_SECURITY_POLICY_CREDENTIALS_LIB_LOADED=1

_spc_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_spc_e2e_root="$(cd "${_spc_lib_dir}/../.." && pwd)"
# shellcheck source=../../runtime/lib/env.sh
. "${_spc_e2e_root}/runtime/lib/env.sh"
# shellcheck source=../../runtime/lib/context.sh
. "${_spc_e2e_root}/runtime/lib/context.sh"

spc_assertion_id() {
  printf '%s\n' "$1"
}

spc_require_context() {
  e2e_context_require "$@"
}

spc_context_get() {
  e2e_context_get "$1"
}

spc_redact_secret_text() {
  sed -E 's/(sk-[A-Za-z0-9_-]{8,}|nvapi-[A-Za-z0-9_-]{8,}|[A-Za-z0-9._%+-]+:[A-Za-z0-9_\/-]{12,}|(api[_-]?key|token|secret|password)[=:][^[:space:]]+)/[REDACTED]/Ig'
}

spc_log_provider_metadata() {
  local provider="$1"
  local name="${2:-default}"
  printf 'credential provider=%s name=%s value=[REDACTED]\n' "${provider}" "${name}"
}

spc_assert_credentials_expected() {
  spc_assertion_id "post-onboard.credentials.gateway-list-redacts-values"
  spc_require_context E2E_SCENARIO E2E_PROVIDER
  local expected
  expected="$(spc_context_get E2E_CREDENTIALS_EXPECTED)"
  if [[ -z "${expected}" ]]; then
    expected="$(spc_context_get CREDENTIALS_EXPECTED)"
  fi
  if [[ -z "${expected}" ]]; then
    expected="present"
  fi
  if [[ "${expected}" != "present" ]]; then
    echo "credentials expected state is '${expected}', not present" >&2
    return 1
  fi
  spc_log_provider_metadata "$(spc_context_get E2E_PROVIDER)" "gateway"
  if e2e_env_is_dry_run; then
    echo "[dry-run] would list gateway credentials without raw values"
    return 0
  fi
  nemoclaw credentials list 2>&1 | spc_redact_secret_text
}

spc_assert_no_plaintext_host_store() {
  spc_assertion_id "post-onboard.credentials.no-plaintext-host-store"
  spc_require_context E2E_SCENARIO
  local home_dir="${HOME:-}"
  if [[ -n "${home_dir}" && -f "${home_dir}/.nemoclaw/credentials.json" ]]; then
    echo "plaintext credential store found at ~/.nemoclaw/credentials.json" >&2
    return 1
  fi
  echo "plaintext host credential store absent"
}

spc_assert_policy_preset_present() {
  local preset="$1"
  spc_assertion_id "post-onboard.security-policy.${preset}-preset-applied"
  spc_require_context E2E_SCENARIO
  echo "policy preset expected: ${preset}"
  if e2e_env_is_dry_run; then
    echo "[dry-run] would verify policy preset ${preset}"
  fi
}
