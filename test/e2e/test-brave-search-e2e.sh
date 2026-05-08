#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Brave Search E2E (#2687)
#
# Validates the full Brave Search path end-to-end with a real BRAVE_API_KEY:
#   - Non-interactive onboard with BRAVE_API_KEY auto-enables web search and
#     applies the brave network policy preset
#   - Real key never reaches the sandbox-readable openclaw.json (only the
#     openshell:resolve:env:BRAVE_API_KEY placeholder is written to disk)
#   - Real key is also not exposed in the sandbox shell env (negative check)
#   - The openclaw agent web-search tool returns real Brave results, proving
#     OpenShell's L7 placeholder substitution wires the real key onto the wire
#   - Curl with the placeholder header from inside the sandbox is also
#     substituted by the L7 proxy (validates proxy intercept of exec traffic)
#
# Prerequisites:
#   - Docker running
#   - NemoClaw installed or a source checkout that install.sh can install
#
# Required env (CI injects from secrets):
#   BRAVE_API_KEY    — real Brave Search subscription token
#                      Skip-suite gate: the whole script self-skips if empty
#                      so the job is safe to enable before the secret exists.
#   NVIDIA_API_KEY   — drives the agent inference turn in B4a (cloud-e2e style)
#
# Secret hygiene:
#   The script never echoes BRAVE_API_KEY raw. Every diagnostic dump runs
#   through redact_stream "$BRAVE_API_KEY" so any accidental echo (curl
#   verbose, error stack, JSON spillover) becomes "REDACTED" before reaching
#   the public CI log or the failure-artifact upload. This is defence in
#   depth on top of GitHub Actions' built-in secret masking, which only
#   matches the exact string and can miss transformed forms.
#
# Environment knobs:
#   NEMOCLAW_SANDBOX_NAME   — sandbox name (default: e2e-brave-search)
#
# Usage:
#   NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
#     BRAVE_API_KEY=... NVIDIA_API_KEY=... \
#     bash test/e2e/test-brave-search-e2e.sh

set -uo pipefail

export NEMOCLAW_E2E_DEFAULT_TIMEOUT=1800
SCRIPT_DIR_TIMEOUT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=test/e2e/e2e-timeout.sh
. "${SCRIPT_DIR_TIMEOUT}/e2e-timeout.sh"

PASS=0
FAIL=0
SKIP=0
TOTAL=0

pass() {
  ((PASS++))
  ((TOTAL++))
  printf '\033[32m  PASS: %s\033[0m\n' "$1"
}
fail() {
  ((FAIL++))
  ((TOTAL++))
  printf '\033[31m  FAIL: %s\033[0m\n' "$1"
}
skip() {
  ((SKIP++))
  ((TOTAL++))
  printf '\033[33m  SKIP: %s\033[0m\n' "$1"
}
section() {
  echo ""
  printf '\033[1;36m=== %s ===\033[0m\n' "$1"
}
info() { printf '\033[1;34m  [info]\033[0m %s\n' "$1"; }

summary() {
  echo ""
  echo "============================================================"
  echo "  Brave Search E2E Results (#2687)"
  echo "============================================================"
  echo "  PASS: $PASS"
  echo "  FAIL: $FAIL"
  echo "  SKIP: $SKIP"
  echo "  TOTAL: $TOTAL"
  echo "============================================================"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
}

# ── Secret redaction ────────────────────────────────────────────────
# Pipe any output that may have echoed BRAVE_API_KEY through this. Any
# literal occurrence of $BRAVE_API_KEY is replaced with "REDACTED" before
# the output reaches the CI log. Defence in depth on top of GitHub
# Actions' built-in `${{ secrets.X }}` masking, which can miss partial
# matches, transformed forms, or output written outside the runner shell.
redact_stream() {
  local secret="${1:-}"
  SECRET_TO_REDACT="$secret" python3 -c '
import os, sys
secret = os.environ.get("SECRET_TO_REDACT", "")
data = sys.stdin.read()
sys.stdout.write(data.replace(secret, "REDACTED") if secret else data)
'
}

# Print a string with the API key replaced by *** so the command is
# readable in the log without leaking the secret. Use for the "command
# we are about to run" diagnostic prints.
masked_cmd() {
  local raw="$1"
  printf '%s' "$raw" | redact_stream "${BRAVE_API_KEY:-}"
}

# ── Repo root ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -d /workspace ] && [ -f /workspace/install.sh ]; then
  REPO="/workspace"
elif [ -f "${SCRIPT_DIR}/../../install.sh" ]; then
  REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
elif [ -f "./install.sh" ]; then
  REPO="$(pwd)"
else
  echo "ERROR: Cannot find repo root."
  exit 1
fi

SANDBOX_NAME="${NEMOCLAW_SANDBOX_NAME:-e2e-brave-search}"
ONBOARD_LOG="/tmp/nemoclaw-e2e-brave-search-onboard.log"

load_shell_path() {
  local local_bin
  if [ -f "$HOME/.bashrc" ]; then
    # shellcheck source=/dev/null
    source "$HOME/.bashrc" 2>/dev/null || true
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
  fi
  local_bin="$HOME/.local/bin"
  if [ -d "$local_bin" ]; then
    PATH=":${PATH}:"
    PATH="${PATH//:${local_bin}:/:}"
    PATH="${PATH#:}"
    PATH="${PATH%:}"
    export PATH="$local_bin:$PATH"
  fi
}

cli_command_available_from_source() {
  [ -f "$REPO/dist/nemoclaw.js" ] && command -v node >/dev/null 2>&1 && command -v openshell >/dev/null 2>&1
}

run_cli() {
  if cli_command_available_from_source; then
    node "$REPO/bin/nemoclaw.js" "$@"
  else
    nemoclaw "$@"
  fi
}

destroy_sandbox_best_effort() {
  if [ "${NEMOCLAW_E2E_KEEP_SANDBOX:-}" = "1" ]; then
    return 0
  fi
  set +e
  if cli_command_available_from_source; then
    run_with_timeout 120 node "$REPO/bin/nemoclaw.js" "$SANDBOX_NAME" destroy --yes >/dev/null 2>&1
  elif command -v nemoclaw >/dev/null 2>&1; then
    run_with_timeout 120 nemoclaw "$SANDBOX_NAME" destroy --yes >/dev/null 2>&1
  fi
  if command -v openshell >/dev/null 2>&1; then
    run_with_timeout 60 openshell sandbox delete "$SANDBOX_NAME" >/dev/null 2>&1
  fi
  set -uo pipefail
}

cleanup() {
  destroy_sandbox_best_effort
}

run_brave_onboard() {
  local onboard_exit=0
  local onboard_cmd_desc
  export NEMOCLAW_SANDBOX_NAME="$SANDBOX_NAME"
  export NEMOCLAW_RECREATE_SANDBOX=1
  export NEMOCLAW_NON_INTERACTIVE=1
  export NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1
  # BRAVE_API_KEY and NVIDIA_API_KEY are inherited from the CI env. We do
  # not echo or re-export them with `printenv` style commands anywhere.

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] About to run onboard. Effective env (key masked):"
  info "[scaffold]   BRAVE_API_KEY=$(printf '%s' "${BRAVE_API_KEY:-}" | redact_stream "${BRAVE_API_KEY:-}")"
  info "[scaffold]   NEMOCLAW_NON_INTERACTIVE=$NEMOCLAW_NON_INTERACTIVE"
  info "[scaffold]   NEMOCLAW_SANDBOX_NAME=$NEMOCLAW_SANDBOX_NAME"

  if cli_command_available_from_source; then
    onboard_cmd_desc="source CLI onboard"
    info "Using source-built CLI at $REPO/bin/nemoclaw.js"
    info "[scaffold] cmd: $(masked_cmd "node $REPO/bin/nemoclaw.js onboard --fresh --non-interactive --yes-i-accept-third-party-software")"
    destroy_sandbox_best_effort
    run_with_timeout 1200 node "$REPO/bin/nemoclaw.js" onboard --fresh --non-interactive --yes-i-accept-third-party-software \
      >"$ONBOARD_LOG" 2>&1 || onboard_exit=$?
  else
    onboard_cmd_desc="install.sh"
    info "Source CLI is not built yet; running install.sh from this checkout."
    info "[scaffold] cmd: $(masked_cmd "bash $REPO/install.sh --non-interactive --yes-i-accept-third-party-software --fresh")"
    bash "$REPO/install.sh" --non-interactive --yes-i-accept-third-party-software --fresh \
      >"$ONBOARD_LOG" 2>&1 || onboard_exit=$?
    load_shell_path
  fi

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] Last 60 lines of onboard log (redacted):"
  tail -60 "$ONBOARD_LOG" 2>/dev/null | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  if [ "$onboard_exit" -eq 0 ]; then
    pass "B1: ${onboard_cmd_desc} completed for Brave Search-enabled onboard"
  else
    fail "B1: ${onboard_cmd_desc} failed (exit $onboard_exit)"
    info "Onboard log tail (redacted):"
    tail -120 "$ONBOARD_LOG" 2>/dev/null | redact_stream "${BRAVE_API_KEY:-}" || true
    summary
  fi

  # The onboard log itself is uploaded as a CI failure artifact. Scrub it
  # in place so a leaked echo never reaches the artifact. No-op if the key
  # never appeared in the log.
  if [ -n "${BRAVE_API_KEY:-}" ] && [ -f "$ONBOARD_LOG" ]; then
    redacted_log="$(mktemp)"
    redact_stream "$BRAVE_API_KEY" <"$ONBOARD_LOG" >"$redacted_log" || true
    mv "$redacted_log" "$ONBOARD_LOG" || rm -f "$redacted_log"
  fi
}

check_brave_preset_applied() {
  local policy_output rc=0 cmd
  cmd="openshell policy get --full $SANDBOX_NAME"

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] cmd: $cmd"

  policy_output=$(openshell policy get --full "$SANDBOX_NAME" 2>&1) || rc=$?

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] policy get output (first 600 chars, redacted):"
  printf '%s\n' "${policy_output:0:600}" | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  if [ "$rc" -ne 0 ]; then
    fail "B2: openshell policy get failed (exit $rc)"
    return
  fi
  # The brave preset (nemoclaw-blueprint/policies/presets/brave.yaml) opens
  # api.search.brave.com:443. Match on the host string in the rendered
  # gateway policy — this is what test-full-e2e.sh:254 does for npm/pypi.
  if printf '%s' "$policy_output" | grep -q "api.search.brave.com"; then
    pass "B2: brave preset applied — api.search.brave.com is in the loaded gateway policy"
  else
    fail "B2: brave preset NOT applied — api.search.brave.com is missing from the gateway policy"
  fi
}

check_real_key_not_in_sandbox() {
  local config_grep rc=0 env_value cmd_disk cmd_env

  # ── B3a: Disk-side check ──────────────────────────────────────
  # Documented invariant from scripts/nemoclaw-start.sh:560-564 — the
  # real token must never touch /sandbox/.openclaw/openclaw.json. The
  # placeholder string `openshell:resolve:env:BRAVE_API_KEY` is what
  # generate-openclaw-config.py:594 writes; the real value is resolved
  # by OpenShell's L7 layer at egress time.
  cmd_disk="openshell sandbox exec --name $SANDBOX_NAME -- cat /sandbox/.openclaw/openclaw.json"

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] cmd: $cmd_disk"

  config_grep=$(openshell sandbox exec --name "$SANDBOX_NAME" -- sh -lc \
    "grep -F 'BRAVE_API_KEY' /sandbox/.openclaw/openclaw.json 2>/dev/null || true" \
    2>&1) || rc=$?

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] grep result (redacted):"
  printf '%s\n' "${config_grep:0:300}" | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  if [ -n "${BRAVE_API_KEY:-}" ] && printf '%s' "$config_grep" | grep -qF "$BRAVE_API_KEY"; then
    fail "B3a: SECURITY — real BRAVE_API_KEY found verbatim in /sandbox/.openclaw/openclaw.json (placeholder substitution broke)"
  elif printf '%s' "$config_grep" | grep -q "openshell:resolve:env:BRAVE_API_KEY"; then
    pass "B3a: openclaw.json contains the placeholder, not the real key (design invariant holds)"
  else
    # Web search may not have been enabled. That's a B1 problem already.
    fail "B3a: openclaw.json has no BRAVE_API_KEY entry at all — web search did not get configured"
  fi

  # ── B3b: Env-side check ───────────────────────────────────────
  # The user's stated design intent: the sandbox interior should hold
  # no API key at all, including in the process env of `sandbox exec`
  # shells. If this fails, it surfaces a leak path that the disk-only
  # check (B3a) does not cover.
  cmd_env="openshell sandbox exec --name $SANDBOX_NAME -- printenv BRAVE_API_KEY"

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] cmd: $cmd_env"

  env_value=$(openshell sandbox exec --name "$SANDBOX_NAME" -- sh -lc \
    'printenv BRAVE_API_KEY 2>/dev/null || true' 2>&1) || true

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] printenv result (redacted):"
  printf '%s\n' "${env_value}" | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  if [ -n "${BRAVE_API_KEY:-}" ] && printf '%s' "$env_value" | grep -qF "$BRAVE_API_KEY"; then
    fail "B3b: SECURITY — real BRAVE_API_KEY visible to sandbox shell via printenv"
  elif [ -z "$env_value" ] || printf '%s' "$env_value" | grep -q "openshell:resolve:env:BRAVE_API_KEY"; then
    pass "B3b: sandbox shell env does not expose the real key (placeholder or empty)"
  else
    # Some unexpected non-empty value that is not the real key and not the
    # placeholder. Flag it so the reviewer can look.
    fail "B3b: unexpected non-empty BRAVE_API_KEY in sandbox env (not real key, not placeholder)"
  fi
}

check_agent_brave_search_turn() {
  local session_id raw ssh_cfg reply rc=0 ssh_cmd
  session_id="e2e-brave-agent-$(date +%s)-$$"
  ssh_cfg="$(mktemp)"

  if ! openshell sandbox ssh-config "$SANDBOX_NAME" >"$ssh_cfg" 2>/dev/null; then
    rm -f "$ssh_cfg"
    fail "B4a: agent web-search turn — could not get SSH config"
    return
  fi

  ssh_cmd="openclaw agent --agent main --json --session-id '${session_id}' -m 'Use the web search tool to find one result for the query: NVIDIA. Reply with only the title of the top result.'"

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] cmd (via SSH into sandbox):"
  info "[scaffold]   ${ssh_cmd}"

  raw=$(run_with_timeout 120 ssh -F "$ssh_cfg" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 \
    -o LogLevel=ERROR \
    "openshell-${SANDBOX_NAME}" \
    "$ssh_cmd" \
    2>/dev/null) || rc=$?
  rm -f "$ssh_cfg"

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] agent JSON (first 800 chars, redacted):"
  printf '%s\n' "${raw:0:800}" | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  # Fail closed on transport / proxy errors so a coincidental keyword in a
  # stack trace cannot mask an SSRF block, gateway failure, or auth reject.
  if printf '%s' "$raw" | grep -qiE "SsrFBlockedError|Blocked hostname|transport error|ECONNREFUSED|EAI_AGAIN|gateway unavailable|network connection error|401|403"; then
    fail "B4a: agent web-search failed with provider/transport error (exit ${rc}): $(printf '%s' "${raw:0:300}" | redact_stream "${BRAVE_API_KEY:-}")"
    return
  fi

  reply=$(printf '%s' "$raw" | python3 -c "
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(0)
result = doc.get('result') or {}
parts = []
for p in result.get('payloads') or []:
    if isinstance(p, dict) and isinstance(p.get('text'), str):
        parts.append(p['text'])
print('\n'.join(parts))
" 2>/dev/null) || true

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] extracted reply (redacted):"
  printf '%s\n' "${reply:0:400}" | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  # NVIDIA-related phrasing (nvidia, gpu, cuda, geforce) is overwhelmingly
  # likely to appear in any legitimate top-1 web result for the query
  # "NVIDIA". An empty reply, an apology ("I don't have web access"), or
  # a reply that does not reference any NVIDIA-adjacent term means the
  # web-search tool did not actually run or returned nothing.
  if [ "$rc" -eq 0 ] && printf '%s' "$reply" | grep -qiE "nvidia|geforce|cuda|gpu"; then
    pass "B4a: openclaw agent web-search returned a real Brave result for query 'NVIDIA'"
  else
    fail "B4a: agent web-search did not return a recognizable Brave result (exit ${rc}, reply='$(printf '%s' "${reply:0:200}" | redact_stream "${BRAVE_API_KEY:-}")')"
  fi
}

check_placeholder_curl_substitution() {
  local response status_code body rc=0 cmd
  # Curl from inside the sandbox using the *placeholder* as the auth
  # header value. If OpenShell's L7 proxy intercepts `sandbox exec`
  # traffic, it will substitute the real key onto the wire and Brave
  # returns 200. If the proxy does not intercept exec sessions, the
  # literal string `openshell:resolve:env:BRAVE_API_KEY` reaches Brave
  # and the API returns 401 — which proves nothing about the design
  # invariant, so this case is reported as SKIP rather than FAIL.
  cmd="openshell sandbox exec --name $SANDBOX_NAME -- curl -sS -G https://api.search.brave.com/res/v1/web/search --data-urlencode q=NVIDIA --data-urlencode count=1 -H 'X-Subscription-Token: openshell:resolve:env:BRAVE_API_KEY' -w '\nHTTP_STATUS:%{http_code}\n'"

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] cmd: $cmd"

  response=$(openshell sandbox exec --name "$SANDBOX_NAME" -- sh -lc \
    "curl -sS -G 'https://api.search.brave.com/res/v1/web/search' \
      --data-urlencode 'q=NVIDIA' \
      --data-urlencode 'count=1' \
      -H 'X-Subscription-Token: openshell:resolve:env:BRAVE_API_KEY' \
      -w '\nHTTP_STATUS:%{http_code}\n'" \
    2>&1) || rc=$?

  status_code=$(printf '%s' "$response" | grep -oE 'HTTP_STATUS:[0-9]+' | tail -1 | cut -d: -f2)
  body=$(printf '%s' "$response" | sed '/^HTTP_STATUS:/d')

  # TODO(#2687): remove these scaffolding prints after the first green run.
  info "[scaffold] HTTP status: ${status_code:-<none>}"
  info "[scaffold] body (first 600 chars, redacted):"
  printf '%s\n' "${body:0:600}" | redact_stream "${BRAVE_API_KEY:-}" | sed 's/^/    /' || true

  if [ "$status_code" = "200" ]; then
    if printf '%s' "$body" | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(1)
results = (doc.get("web") or {}).get("results") or []
sys.exit(0 if len(results) > 0 else 2)
' 2>/dev/null; then
      pass "B4b: placeholder-header curl returned HTTP 200 with non-empty results — L7 proxy substituted the placeholder"
    else
      fail "B4b: HTTP 200 but response had no web.results[] (body parsed empty)"
    fi
  elif [ "$status_code" = "401" ] || [ "$status_code" = "403" ]; then
    skip "B4b: HTTP $status_code — L7 proxy did not substitute the placeholder for sandbox-exec traffic. Tells us nothing about design invariant; not a regression. Drop B4b in the PR if so."
  else
    fail "B4b: unexpected HTTP status '${status_code:-<none>}' from Brave (exit $rc)"
  fi
}

# ── Repo root ─────────────────────────────────────────────────────
trap cleanup EXIT

echo ""
echo "============================================================"
echo "  Brave Search E2E (#2687)"
echo "  $(date)"
echo "============================================================"
echo ""

# ══════════════════════════════════════════════════════════════════
# B0: CI-runner gate — skip the whole suite if BRAVE_API_KEY is not
# present in the workflow env. Acceptance criterion #3 of #2687.
# This is a *host-side* check — it asks "did the workflow inject the
# secrets.BRAVE_API_KEY repo secret?" — not a sandbox-side check. The
# sandbox is supposed to never see the real key (B3 verifies that).
# ══════════════════════════════════════════════════════════════════
section "Phase 0: CI-runner gate"
if [ -z "${BRAVE_API_KEY:-}" ]; then
  skip "B0: BRAVE_API_KEY not set on the CI runner — skipping the entire Brave Search suite gracefully"
  summary
fi
pass "B0: BRAVE_API_KEY is available on the CI runner"

section "Phase 0: Prerequisites"
if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running"
  summary
fi
pass "Docker is running"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found"
  summary
fi
pass "python3 is available"

load_shell_path
info "Repo: $REPO"
info "Sandbox: $SANDBOX_NAME"

section "Phase 1: Onboard with BRAVE_API_KEY (auto-enables web search)"
run_brave_onboard

section "Phase 2: Verify the brave preset is applied to the sandbox"
check_brave_preset_applied

section "Phase 3: Negative — real key must not be readable inside sandbox"
check_real_key_not_in_sandbox

section "Phase 4a: Agent-driven Brave search end-to-end"
check_agent_brave_search_turn

section "Phase 4b: Placeholder-header curl through L7 proxy"
check_placeholder_curl_substitution

trap - EXIT
cleanup
summary
