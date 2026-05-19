#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Best-effort diagnostic capture for OpenClaw-mediated E2E failures.
# These helpers keep assertion stdout clean while preserving stderr, gateway
# logs, process state, OpenClaw config, and session JSONL as CI artifacts.

openclaw_diag_slug() {
  printf '%s' "${1:-unknown}" | tr -c 'A-Za-z0-9_.-' '-'
}

openclaw_diag_quote_sh() {
  printf "'%s'" "$(printf '%s' "${1:-}" | sed "s/'/'\\\\''/g")"
}

openclaw_diag_redact() {
  sed -E \
    -e 's/(nvapi-)[A-Za-z0-9._-]+/\1[REDACTED]/g' \
    -e 's/(Bearer )[A-Za-z0-9._~+\/=-]+/\1[REDACTED]/g' \
    -e 's/(([aA][pP][iI][kK][eE][yY]|[tT][oO][kK][eE][nN]|[sS][eE][cC][rR][eE][tT]|[pP][aA][sS][sS][wW][oO][rR][dD])"?[[:space:]]*:[[:space:]]*"?)[^",}[:space:]]+/\1[REDACTED]/g' \
    -e 's/^([A-Za-z0-9_]*([Tt][Oo][Kk][Ee][Nn]|[Kk][Ee][Yy]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd])[A-Za-z0-9_]*=).*/\1[REDACTED]/'
}

openclaw_diag_init() {
  local sandbox="${1:-}"
  local label="${2:-openclaw}"
  local sandbox_slug label_slug

  sandbox_slug="$(openclaw_diag_slug "$sandbox")"
  label_slug="$(openclaw_diag_slug "$label")"
  OPENCLAW_DIAG_SANDBOX="$sandbox"
  OPENCLAW_DIAG_LABEL="$label_slug"
  OPENCLAW_DIAG_DIR="${OPENCLAW_DIAG_DIR:-/tmp/nemoclaw-openclaw-diagnostics-${label_slug}-${sandbox_slug}}"
  mkdir -p "$OPENCLAW_DIAG_DIR"

  {
    echo "label=$OPENCLAW_DIAG_LABEL"
    echo "sandbox=$OPENCLAW_DIAG_SANDBOX"
    echo "dir=$OPENCLAW_DIAG_DIR"
    date -u +"captured_at_utc=%Y-%m-%dT%H:%M:%SZ"
  } >"${OPENCLAW_DIAG_DIR}/metadata.txt"

  export OPENCLAW_DIAG_SANDBOX OPENCLAW_DIAG_LABEL OPENCLAW_DIAG_DIR
}

openclaw_diag_capture_snapshot() {
  local phase="${1:-snapshot}"
  local sandbox="${2:-${OPENCLAW_DIAG_SANDBOX:-}}"
  local phase_slug out

  if [ -z "$sandbox" ]; then
    return 0
  fi
  if [ -z "${OPENCLAW_DIAG_DIR:-}" ]; then
    openclaw_diag_init "$sandbox" "openclaw"
  fi

  phase_slug="$(openclaw_diag_slug "$phase")"
  out="${OPENCLAW_DIAG_DIR}/${phase_slug}-snapshot.log"

  {
    echo "=== host ==="
    date -u +"utc=%Y-%m-%dT%H:%M:%SZ" || true
    uname -a || true
    printf 'sandbox=%s\n' "$sandbox"
    printf 'repo=%s\n' "$(pwd)"
    printf 'nemoclaw=%s\n' "$(command -v nemoclaw 2>/dev/null || true)"
    printf 'openshell=%s\n' "$(command -v openshell 2>/dev/null || true)"
    nemoclaw --version 2>&1 || true
    openshell --version 2>&1 || true
    openshell inference get -g nemoclaw 2>&1 || openshell inference get 2>&1 || true
    openshell sandbox list 2>&1 || true
    openshell sandbox ssh-config "$sandbox" 2>&1 || true

    echo ""
    echo "=== sandbox ==="
    # shellcheck disable=SC2016  # The script runs inside the sandbox.
    openshell sandbox exec --name "$sandbox" -- sh -lc '
set +e
echo "--- identity ---"
date -u +"utc=%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date
whoami 2>/dev/null || true
pwd 2>/dev/null || true

echo "--- versions ---"
nemoclaw --version 2>&1 || true
openshell --version 2>&1 || true
openclaw --version 2>&1 || true
node --version 2>&1 || true

echo "--- selected env ---"
env | sort | grep -E "^(OPENCLAW|NEMOCLAW|OPENSHELL|NODE|HTTPS?_PROXY|NO_PROXY|PATH|HOME|USER)=" || true

echo "--- processes ---"
ps -eo pid,ppid,user,stat,comm,args 2>/dev/null | sed -n "1,260p" || ps aux 2>/dev/null | sed -n "1,260p" || true

echo "--- listeners ---"
ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || netstat -an 2>/dev/null | sed -n "1,120p" || true

echo "--- key paths ---"
for d in /tmp /sandbox/.openclaw /sandbox/.openclaw/agents /sandbox/.openclaw/agents/main /sandbox/.openclaw/agents/main/sessions /home/sandbox/.openclaw /root/.openclaw; do
  [ -e "$d" ] || continue
  printf "\n### ls -la %s\n" "$d"
  ls -la "$d" 2>&1 | sed -n "1,160p"
done

echo "--- gateway logs ---"
for f in /tmp/gateway.log /tmp/openclaw-gateway.log /tmp/nemoclaw-gateway.log; do
  [ -f "$f" ] || continue
  printf "\n### %s tail\n" "$f"
  tail -400 "$f" 2>&1
done

echo "--- proxy env ---"
for f in /tmp/nemoclaw-proxy-env.sh /tmp/nemoclaw-runtime-env.sh; do
  [ -f "$f" ] || continue
  printf "\n### %s\n" "$f"
  cat "$f" 2>&1
done

echo "--- openclaw config ---"
for f in /sandbox/.openclaw/openclaw.json /home/sandbox/.openclaw/openclaw.json /root/.openclaw/openclaw.json; do
  [ -f "$f" ] || continue
  printf "\n### %s\n" "$f"
  cat "$f" 2>&1
done

echo "--- latest session files ---"
for d in /sandbox/.openclaw/agents/main/sessions /home/sandbox/.openclaw/agents/main/sessions /root/.openclaw/agents/main/sessions; do
  [ -d "$d" ] || continue
  find "$d" -maxdepth 1 -type f 2>/dev/null | sort | tail -80 | while IFS= read -r f; do
    [ -f "$f" ] || continue
    printf "\n### %s size=%s\n" "$f" "$(wc -c <"$f" 2>/dev/null || echo ?)"
    tail -c 200000 "$f" 2>&1
  done
done
' 2>&1 || true
  } | openclaw_diag_redact >"$out"
}

openclaw_diag_run_agent_turn() {
  local sandbox="$1"
  local ssh_config="$2"
  local seconds="$3"
  local session_id="$4"
  local prompt="$5"
  local label="${6:-agent-turn}"
  shift 6 || true
  local extra_args=("$@")
  local label_slug out err combined meta remote_cmd rc arg had_errexit

  if [ -z "${OPENCLAW_DIAG_DIR:-}" ]; then
    openclaw_diag_init "$sandbox" "openclaw-agent"
  fi

  label_slug="$(openclaw_diag_slug "$label")"
  out="${OPENCLAW_DIAG_DIR}/${label_slug}.stdout.json"
  err="${OPENCLAW_DIAG_DIR}/${label_slug}.stderr.log"
  combined="${OPENCLAW_DIAG_DIR}/${label_slug}.combined.log"
  meta="${OPENCLAW_DIAG_DIR}/${label_slug}.meta.txt"

  remote_cmd="nemoclaw-start openclaw agent --agent main --json"
  for arg in "${extra_args[@]}"; do
    remote_cmd+=" $(openclaw_diag_quote_sh "$arg")"
  done
  remote_cmd+=" --session-id $(openclaw_diag_quote_sh "$session_id") -m $(openclaw_diag_quote_sh "$prompt")"

  {
    echo "label=$label"
    echo "sandbox=$sandbox"
    echo "session_id=$session_id"
    echo "timeout_seconds=$seconds"
    echo "remote_cmd=$remote_cmd"
    date -u +"started_at_utc=%Y-%m-%dT%H:%M:%SZ"
  } | openclaw_diag_redact >"$meta"

  rc=0
  had_errexit=0
  case "$-" in
    *e*) had_errexit=1 ;;
  esac
  set +e
  if [ "${NEMOCLAW_E2E_NO_TIMEOUT:-0}" != "1" ] && [ -n "${TIMEOUT_CMD:-}" ] && [[ "${TIMEOUT_CMD}" != *" "* ]]; then
    "$TIMEOUT_CMD" "$seconds" ssh -F "$ssh_config" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      -o LogLevel=ERROR \
      "openshell-${sandbox}" "$remote_cmd" >"$out" 2>"$err"
    rc=$?
  elif [ "${NEMOCLAW_E2E_NO_TIMEOUT:-0}" != "1" ] && command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" ssh -F "$ssh_config" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      -o LogLevel=ERROR \
      "openshell-${sandbox}" "$remote_cmd" >"$out" 2>"$err"
    rc=$?
  else
    ssh -F "$ssh_config" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      -o LogLevel=ERROR \
      "openshell-${sandbox}" "$remote_cmd" >"$out" 2>"$err"
    rc=$?
  fi
  if [ "$had_errexit" -eq 1 ]; then
    set -e
  else
    set +e
  fi

  # shellcheck disable=SC2034  # Callers read these globals after the helper returns.
  OPENCLAW_DIAG_LAST_RC="$rc"
  # shellcheck disable=SC2034  # Callers read this global after the helper returns.
  OPENCLAW_DIAG_LAST_STDOUT="$(cat "$out" 2>/dev/null || true)"
  # shellcheck disable=SC2034  # Callers read this global after the helper returns.
  OPENCLAW_DIAG_LAST_STDERR="$(cat "$err" 2>/dev/null || true)"

  {
    echo "exit_code=$rc"
    echo "stdout_bytes=$(wc -c <"$out" 2>/dev/null || echo 0)"
    echo "stderr_bytes=$(wc -c <"$err" 2>/dev/null || echo 0)"
    echo ""
    echo "=== stdout ==="
    cat "$out" 2>/dev/null || true
    echo ""
    echo "=== stderr ==="
    cat "$err" 2>/dev/null || true
  } | openclaw_diag_redact >"$combined"

  openclaw_diag_capture_snapshot "${label_slug}-post" "$sandbox" || true
  return "$rc"
}
