#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Extract the four fingerprint dimensions from a PR diff:
#   - touched files
#   - touched symbols (per-language regex)
#   - error-string tokens
#   - primary linked issue (for exclusion)
#
# Usage: extract-fingerprint.sh <pr-number> [--repo OWNER/REPO]
# Output: JSON to stdout

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <pr-number> [--repo OWNER/REPO]" >&2
  exit 64
fi

pr="$1"
shift || true
repo_args=()
if [ "${1:-}" = "--repo" ] && [ -n "${2:-}" ]; then
  repo_args=(--repo "$2")
fi

# Touched files (drop test fixtures, lockfiles, generated outputs).
files=$(gh pr view "$pr" "${repo_args[@]}" --json files --jq '[.files[].path] | map(select(
    test("/(fixtures|generated|node_modules)/") | not
  )) | map(select(
    endswith("package-lock.json") or endswith("yarn.lock") or endswith("pnpm-lock.yaml") | not
  ))' 2>/dev/null) || files='[]'

# Diff for symbol + error-string extraction.
diff=$(gh pr diff "$pr" "${repo_args[@]}" 2>/dev/null) || diff=""

# Touched symbols. Extract from added/modified lines (start with `+`, not `+++`).
# Per-language regex; defaults match TypeScript/JavaScript/Python/Go/shell.
added_lines=$(printf '%s' "$diff" | grep -E '^\+[^+]' | sed 's/^+//')

extract_symbols() {
  printf '%s' "$1" | grep -oE 'function [A-Za-z_$][A-Za-z0-9_$]*' | awk '{print $2}'
  printf '%s' "$1" | grep -oE 'class [A-Za-z_$][A-Za-z0-9_$]*' | awk '{print $2}'
  printf '%s' "$1" | grep -oE 'def [A-Za-z_][A-Za-z0-9_]*' | awk '{print $2}'
  printf '%s' "$1" | grep -oE 'func [A-Z][A-Za-z0-9_]*' | awk '{print $2}'
  printf '%s' "$1" | grep -oE 'const [A-Za-z_$][A-Za-z0-9_$]*' | awk '{print $2}'
  printf '%s' "$1" | grep -oE 'export (function|class|const|let|var|default)? *[A-Za-z_$][A-Za-z0-9_$]*' | awk '{print $NF}'
}

# Drop common short / language-keyword names. Keep symbols >= 4 chars.
symbols=$(extract_symbols "$added_lines" \
  | grep -vE '^(if|for|let|var|const|new|do|of|as|in|is|to|on|at|by|or|and|the|set|get|map|run|all|any)$' \
  | awk 'length($0) >= 4' \
  | sort -u \
  | head -n 50 \
  | jq -Rn '[inputs | select(length > 0)]')

# Error-string tokens. Look for content inside throw new Error("..."), console.error("..."),
# distinctive error-shaped strings starting with capital + 'Error'/'Failed'/etc.
extract_error_strings() {
  printf '%s' "$1" | grep -oE 'throw new Error\("[^"]+"\)' | sed -E 's/throw new Error\("([^"]+)"\)/\1/'
  printf '%s' "$1" | grep -oE 'console\.error\("[^"]+"\)' | sed -E 's/console\.error\("([^"]+)"\)/\1/'
  printf '%s' "$1" | grep -oE '"[A-Z][^"]*\b(Error|Failed|Cannot|Unable|Invalid|Missing|Unsupported)\b[^"]*"' | tr -d '"'
}

error_strings=$(extract_error_strings "$added_lines" \
  | awk 'length($0) >= 8 && /[A-Za-z]/' \
  | sed 's/%[sd]/X/g; s/\${[^}]*}/X/g; s/{[0-9]*}/X/g' \
  | sort -u \
  | head -n 20 \
  | jq -Rn '[inputs | select(length > 0)]')

# Primary linked issue — first match in body for closes/fixes/resolves #N.
body=$(gh pr view "$pr" "${repo_args[@]}" --json body --jq .body 2>/dev/null || echo "")
primary_issue=$(printf '%s' "$body" \
  | grep -oiE '(closes|fixes|resolves|fix)\s+#[0-9]+' \
  | grep -oE '[0-9]+' \
  | head -n 1)
primary_issue="${primary_issue:-null}"

cat <<JSON
{
  "pr": $pr,
  "files": $files,
  "symbols": $symbols,
  "error_strings": $error_strings,
  "primary_issue": $primary_issue
}
JSON
