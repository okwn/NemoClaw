#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Coverage guard for #3513 / #3127 — a fresh sandbox must be able to run the
# first OpenClaw CLI invocation without bundled plugin runtime-deps failing on
# EXDEV cross-device rename.

set -uo pipefail

PASS=0
FAIL=0
TOTAL=0

pass() {
  ((PASS++))
  ((TOTAL++))
  echo "  OK: $1"
}
fail() {
  ((FAIL++))
  ((TOTAL++))
  echo "  ERROR: $1"
}
section() {
  echo ""
  printf '\033[1;36m=== %s ===\033[0m\n' "$1"
}
info() { printf '\033[1;34m  [info]\033[0m %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_NAME="${NEMOCLAW_SANDBOX_NAME:-e2e-openclaw-plugin-exdev}"
ONBOARD_LOG="${E2E_OPENCLAW_PLUGIN_EXDEV_ONBOARD_LOG:-/tmp/nemoclaw-e2e-openclaw-plugin-exdev-onboard.log}"
AGENT_LOG="${E2E_OPENCLAW_PLUGIN_EXDEV_AGENT_LOG:-/tmp/nemoclaw-e2e-openclaw-plugin-exdev-agent.log}"
DF_LOG="${E2E_OPENCLAW_PLUGIN_EXDEV_DF_LOG:-/tmp/nemoclaw-e2e-openclaw-plugin-exdev-df.log}"
TIMEOUT_CMD="${TIMEOUT_CMD:-timeout}"

# shellcheck source=test/e2e/lib/install-path-refresh.sh
. "${SCRIPT_DIR}/lib/install-path-refresh.sh"
# shellcheck source=test/e2e/lib/sandbox-teardown.sh
. "${SCRIPT_DIR}/lib/sandbox-teardown.sh"
register_sandbox_for_teardown "$SANDBOX_NAME"

redact_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  python3 - "$file" <<'PY'
import os, sys
path = sys.argv[1]
secrets = [os.environ.get("NVIDIA_API_KEY", ""), os.environ.get("NEMOCLAW_PROVIDER_KEY", "")]
text = open(path, "r", errors="replace").read()
for secret in filter(None, secrets):
    text = text.replace(secret, "<REDACTED>")
open(path, "w").write(text)
PY
}

cleanup_logs() {
  redact_file "$ONBOARD_LOG"
  redact_file "$AGENT_LOG"
  redact_file "$DF_LOG"
}
trap cleanup_logs EXIT

section "Prerequisites"
if docker info >/dev/null 2>&1; then
  pass "Docker is running"
else
  fail "Docker is not running"
  exit 1
fi

if [ -n "${NVIDIA_API_KEY:-}" ] && [[ "${NVIDIA_API_KEY}" == nvapi-* ]]; then
  pass "NVIDIA_API_KEY is set"
else
  fail "NVIDIA_API_KEY is required and must start with nvapi-"
  exit 1
fi

section "Install NemoClaw from checkout"
if ! command -v nemoclaw >/dev/null 2>&1; then
  NEMOCLAW_NON_INTERACTIVE=1 \
    NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
    bash "${REPO}/install.sh" --non-interactive --yes-i-accept-third-party-software >"$ONBOARD_LOG" 2>&1 || true
  nemoclaw_refresh_install_env
fi

if command -v nemoclaw >/dev/null 2>&1; then
  pass "nemoclaw is available: $(nemoclaw --version 2>/dev/null || echo unknown)"
else
  fail "nemoclaw not found after install"
  exit 1
fi

section "Fresh sandbox onboard"
rm -f "$HOME/.nemoclaw/onboard.lock" 2>/dev/null || true
nemoclaw "$SANDBOX_NAME" destroy --yes >/dev/null 2>&1 || true

env \
  NEMOCLAW_PROVIDER_KEY="$NVIDIA_API_KEY" \
  NEMOCLAW_SANDBOX_NAME="$SANDBOX_NAME" \
  NEMOCLAW_NON_INTERACTIVE=1 \
  NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
  NEMOCLAW_POLICY_TIER="open" \
  NEMOCLAW_PROVIDER="build" \
  NVIDIA_API_KEY="$NVIDIA_API_KEY" \
  "$TIMEOUT_CMD" 1500 nemoclaw onboard --fresh --non-interactive --yes-i-accept-third-party-software \
  >"$ONBOARD_LOG" 2>&1
onboard_rc=$?
redact_file "$ONBOARD_LOG"
if [ "$onboard_rc" -eq 0 ]; then
  pass "fresh sandbox onboard completed"
else
  fail "fresh sandbox onboard failed (exit ${onboard_rc}); see ${ONBOARD_LOG}"
  exit 1
fi

section "Filesystem layout evidence"
openshell sandbox exec --name "$SANDBOX_NAME" -- sh -lc 'df -PT / /tmp /dev/shm /sandbox /sandbox/.openclaw/plugin-runtime-deps 2>&1' \
  >"$DF_LOG" 2>&1 || true
redact_file "$DF_LOG"
info "Filesystem layout captured in ${DF_LOG}"

section "First OpenClaw agent bootstrap with cross-device staging"
agent_rc=0
session_id="plugin-exdev-$(date +%s)"
# Force OpenClaw's bundled runtime-deps staging dir onto /dev/shm (tmpfs) and
# clear any deps preinstalled by gateway startup. On unfixed OpenClaw builds,
# the installer attempts fs.rename(stagedDir, targetDir), which fails with
# EXDEV when stagedDir is on /dev/shm and targetDir is under /sandbox.
remote_cmd="rm -rf /sandbox/.openclaw/plugin-runtime-deps/openclaw-* 2>/dev/null || true; rm -f /sandbox/.openclaw/agents/main/sessions/${session_id}.jsonl.lock /sandbox/.openclaw/agents/main/sessions/${session_id}.trajectory.jsonl 2>/dev/null || true; TMPDIR=/dev/shm openclaw agent --agent main --json --session-id '${session_id}' -m 'Reply with exactly one word: PONG'"
"$TIMEOUT_CMD" 420 openshell sandbox exec --name "$SANDBOX_NAME" -- sh -lc "$remote_cmd" \
  >"$AGENT_LOG" 2>&1 || agent_rc=$?
redact_file "$AGENT_LOG"

if grep -qiE 'EXDEV: cross-device link not permitted|failed to install bundled runtime deps|PluginLoadFailureError' "$AGENT_LOG"; then
  fail "OpenClaw plugin runtime deps hit #3513 EXDEV failure during first agent bootstrap"
  info "Agent log excerpt: $(grep -iE 'EXDEV|failed to install bundled runtime deps|PluginLoadFailureError' "$AGENT_LOG" | head -5 | tr '\n' ' ')"
  exit 1
fi

if [ "$agent_rc" -ne 0 ]; then
  fail "openclaw agent exited ${agent_rc}; see ${AGENT_LOG}"
  exit 1
fi

if grep -qi 'PONG' "$AGENT_LOG"; then
  pass "openclaw agent completed without plugin runtime-deps EXDEV despite cross-device staging"
else
  fail "openclaw agent exited 0 but expected response token was missing; see ${AGENT_LOG}"
  exit 1
fi

section "Summary"
if [ "$FAIL" -eq 0 ]; then
  pass "OpenClaw plugin runtime-deps EXDEV guard passed"
  exit 0
fi
exit 1
