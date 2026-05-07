#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# E2E smoke test for non-root sandbox execution under
# --security-opt no-new-privileges (issue #2571).
#
# Replicates the Brev Launchable / DGX Spark execution constraint
# (PR_SET_NO_NEW_PRIVS) in CI to catch regressions of:
#
#   - PR #2472 (merged 2026-04-25): non-root gateway-startup outage.
#       The bug (before #2472):
#         install_configure_guard wrote to ~/.bashrc / ~/.profile during
#         the entrypoint. Under Landlock the syscall was blocked,
#         `set -e` killed the entrypoint, and the gateway never bound
#         its port — a 5-day outage invisible to existing CI.
#       Current state in main (after #2741):
#         the entrypoint no longer writes rc files at runtime at all;
#         the original Landlock failure mode is architecturally gone.
#         This smoke test guards the *symptom* (entrypoint crash under
#         no-new-privileges) so any future regression of the same class
#         is caught at PR time.
#
#   - PR #2482 (merged 2026-04-25, fixes issue #2480): `openclaw tui`
#     errored with "Missing gateway auth token".
#       The bug (before #2482):
#         #2378 had moved the gateway auth token out of openclaw.json
#         into a runtime file + an OPENCLAW_GATEWAY_TOKEN env var
#         injected only into the gateway process. `openclaw tui` (running
#         as the sandbox user without that env var) had nowhere to find it.
#       Current state in main (after #2741):
#         token is exported via /tmp/nemoclaw-proxy-env.sh sourced by the
#         static rc shims, so openclaw tui inherits it on shell entry.
#         This smoke test guards the symptom ("Missing gateway auth token"
#         in tui output) so future regressions of any link in that export
#         chain are caught.
#
# IMPORTANT CAVEAT:
#   --security-opt no-new-privileges replicates ONE constraint of
#   production but NOT Landlock itself. The exact write that #2472
#   crashed on (~/.bashrc under Landlock) will NOT be reproduced here.
#   This smoke test catches #2472-class bugs only when they manifest as
#   "entrypoint exits non-zero". A follow-up phase needs to attach a
#   real Landlock ruleset; tracked as future work in issue #2571.
#
# How tests work without spinning up the gateway (or OpenShell runtime):
#   The Dockerfile's ENTRYPOINT is `nemoclaw-start` and CMD is
#   `["/bin/bash"]`. Passing a command argument to `docker run` overrides
#   the CMD; the entrypoint captures it into NEMOCLAW_CMD and exec's it
#   *after* completing all setup (line 2511 / 2616 of nemoclaw-start.sh).
#   We use `true` (Test 1) and `bash -lc 'openclaw tui'` (Test 3) as the
#   override, so the entrypoint's setup chain runs end-to-end — detecting
#   any #2472-class crash — without entering the gateway-launch path
#   (which needs a real OpenShell-managed runtime, not raw docker).
#
# Requires: docker

set -euo pipefail

IMAGE="${NEMOCLAW_TEST_IMAGE:-nemoclaw-production}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() {
  echo -e "${GREEN}PASS${NC}: $1"
  PASSED=$((PASSED + 1))
}
fail() {
  echo -e "${RED}FAIL${NC}: $1"
  FAILED=$((FAILED + 1))
}
info() { echo -e "${YELLOW}TEST${NC}: $1"; }

# Temporary verbose logging (#2571 review phase) — surfaces the actual
# command that ran, the raw result of each test, and an explanation of why
# it passed/failed.
cmd()    { echo -e "  ${YELLOW}[cmd]${NC}    $1"; }
result() { echo -e "  ${YELLOW}[result]${NC} $1"; }
why()    { echo -e "  ${YELLOW}[why]${NC}    $1"; }
output() {
  echo -e "  ${YELLOW}[output]${NC} $1"
  echo "$2" | tail -20 | sed 's/^/    /'
}

PASSED=0
FAILED=0

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  fail "Image $IMAGE not found — load it before running this test"
  exit 1
fi

# Helper: run the entrypoint under --security-opt no-new-privileges with
# a final command of the caller's choice. The command is captured by
# nemoclaw-start as NEMOCLAW_CMD and exec'd after entrypoint setup.
# Returns combined stdout+stderr; caller checks $? and/or output.
run_under_nnp() {
  docker run --rm --security-opt no-new-privileges "$IMAGE" "$@" 2>&1 || return $?
}

# ── Test 1: Entrypoint setup completes under no-new-privileges (#2472) ──

info "1. Entrypoint setup chain completes under --security-opt no-new-privileges"
RC=0
OUT=$(run_under_nnp true) || RC=$?
if [ "$RC" -eq 0 ]; then
  pass "entrypoint exited 0 under no-new-privileges (#2472 setup chain healthy)"
  cmd "docker run --rm --security-opt no-new-privileges $IMAGE true"
  result "exit code = $RC"
  why "entrypoint completed every setup step (PATH lockdown, log capture, config integrity check, install_configure_guard, rc shim writes, token export) without crashing under no-new-privileges, then exec'd \`true\` at nemoclaw-start.sh:2616. A #2472-class regression would have exited non-zero before reaching that exec."
  output "entrypoint output (last 20 lines):" "$OUT"
else
  fail "entrypoint exited $RC under no-new-privileges — likely #2472-class regression"
  cmd "docker run --rm --security-opt no-new-privileges $IMAGE true"
  result "exit code = $RC"
  why "entrypoint crashed before exec'ing the command. A setup step likely fails under no-new-privileges (e.g., a new write to a Landlock-protected path without \`|| true\`, a setuid binary that no longer elevates, etc.)."
  output "entrypoint output (last 20 lines):" "$OUT"
fi

# ── Test 2: Kernel confirms PR_SET_NO_NEW_PRIVS is applied (sanity) ──

info "2. Kernel confirms NoNewPrivs=1 inside container (defends against silent flag typos)"
NNP=$(docker run --rm --security-opt no-new-privileges --entrypoint "" "$IMAGE" \
        sh -c 'grep ^NoNewPrivs /proc/self/status' 2>/dev/null \
      | awk '{print $2}' || echo "")
if [ "$NNP" = "1" ]; then
  pass "kernel confirms NoNewPrivs=1"
  cmd "docker run --rm --security-opt no-new-privileges --entrypoint '' $IMAGE sh -c 'grep ^NoNewPrivs /proc/self/status' | awk '{print \$2}'"
  result "/proc/self/status NoNewPrivs = '$NNP'"
  why "the docker flag took effect at the kernel level (PR_SET_NO_NEW_PRIVS = 1). Setuid elevation is blocked inside the container, replicating the Brev Launchable / DGX Spark constraint. Tests 1 and 3 above/below are therefore actually running under the production posture."
else
  fail "expected NoNewPrivs=1 inside container, got '${NNP:-<empty>}'"
  cmd "docker run --rm --security-opt no-new-privileges --entrypoint '' $IMAGE sh -c 'grep ^NoNewPrivs /proc/self/status' | awk '{print \$2}'"
  result "/proc/self/status NoNewPrivs = '${NNP:-<empty>}'"
  why "the --security-opt no-new-privileges flag was silently ignored, or the runtime does not enforce it. Tests 1 and 3 results are NOT meaningful under the actual production constraint until this is fixed (check for a typo in the flag or a Docker version that doesn't accept it)."
fi

# ── Test 3: openclaw tui resolves gateway token under no-new-privileges (#2482) ──

info "3. openclaw tui resolves OPENCLAW_GATEWAY_TOKEN under --security-opt no-new-privileges"
# `bash -lc` forces a login shell so /sandbox/.bashrc and /sandbox/.profile
# (root:root 444 static shims after #2741) are sourced; they pull in
# /tmp/nemoclaw-proxy-env.sh which exports OPENCLAW_GATEWAY_TOKEN. This
# mirrors the real `nemoclaw <name> connect` flow the user takes before
# running `openclaw tui`. A bare `docker run ... openclaw tui` would NOT
# source rc files and could yield a false-positive "Missing gateway auth
# token" even when the chain is healthy.
#
# `timeout 5 openclaw tui` runs the real TUI under a 5s wall clock so
# it doesn't hang waiting for input; we don't care about exit code,
# only about whether the specific error string appears.
OUT=$(run_under_nnp bash -lc 'timeout 60 openclaw tui 2>&1' || true)
if echo "$OUT" | grep -qi 'missing gateway auth token'; then
  fail "openclaw tui reports 'Missing gateway auth token' — #2482-class regression"
  cmd "docker run --rm --security-opt no-new-privileges $IMAGE bash -lc 'timeout 5 openclaw tui 2>&1'"
  result "tui output contains the error string 'Missing gateway auth token'"
  why "a link in the token chain broke. The chain is: entrypoint exports OPENCLAW_GATEWAY_TOKEN → /tmp/nemoclaw-proxy-env.sh → /sandbox/.bashrc | .profile static shim sources it on login → bash -lc inherits env var → openclaw tui reads it at startup. Likely culprits: entrypoint failed to emit the env file, the rc shim is missing the source line, or the login shell is not triggering rc files."
  output "tui output (last 20 lines):" "$OUT"
else
  pass "no 'Missing gateway auth token' in tui output (token chain healthy)"
  cmd "docker run --rm --security-opt no-new-privileges $IMAGE bash -lc 'timeout 5 openclaw tui 2>&1'"
  result "'Missing gateway auth token' string NOT found in tui output"
  why "the token chain worked end-to-end: entrypoint exported OPENCLAW_GATEWAY_TOKEN to /tmp/nemoclaw-proxy-env.sh → the static rc shim sourced it on login shell entry → bash -lc inherited the env var → openclaw tui found the token at startup. This is the same flow as a real \`nemoclaw <name> connect && openclaw tui\` user session."
  output "tui output (last 20 lines):" "$OUT"
fi

# ── Summary ─────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "  Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo -e "${GREEN}========================================${NC}"

[ "$FAILED" -eq 0 ] || exit 1
