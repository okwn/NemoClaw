# Relationship Classification Rules

The four classes the LLM assigns to each candidate issue, with worked examples.

## Contents

- ADJACENT_FIX
- CONTRADICTING
- SAME_ISSUE_DIFF
- UNRELATED

## ADJACENT_FIX

The PR's changes likely *also* resolve this issue, even though the PR doesn't claim to.

**Example:**

PR description: "fix EACCES when shields-down user writes config"
PR diff: adds `chmod g+w` to `.openclaw` directory at startup
Candidate issue #2810: "Telegram preset writes fail intermittently after sandbox rebuild"
Issue body cites: "EPERM on `.openclaw/credentials/telegram.json`"

**Classification:** ADJACENT_FIX, high confidence
**Evidence cited:** PR diff `Dockerfile.base:97` (chmod g+w on .openclaw); issue body line 14 ("EPERM on .openclaw/credentials/telegram.json"). Same root cause (sandbox permissions), same fix.

## CONTRADICTING

The PR's approach makes this issue's desired behavior impossible.

**Example:**

PR description: "remove silent EACCES swallow from Patch 4b"
PR diff: deletes try/catch around `mutateConfigFile`
Candidate issue #4187: "Allow opt-in error suppression for sandbox config writes during shutdown"

**Classification:** CONTRADICTING, medium confidence
**Evidence cited:** PR diff removes `try { ... } catch { /* swallow */ }` at `Dockerfile:142`; issue body line 8 explicitly requests "opt-in suppression for shutdown-time write failures." PR strictly rejects what issue requests.

## SAME_ISSUE_DIFF

The candidate issue describes the same root bug as the PR's primary linked issue. Suppress to avoid double-counting.

**Example:**

PR's primary issue: #2681 ("Enable Dreaming permission error")
Candidate issue #2895: "Toggle in OpenClaw UI fails with EACCES"

Both describe the same EACCES failure on the same toggle. The candidate is a duplicate of the primary issue. **Classification:** SAME_ISSUE_DIFF (suppressed from output).

## UNRELATED

No meaningful relationship. The candidate showed up in search because of token overlap but doesn't align with the PR's actual changes.

**Example:**

PR description: "extract sandbox-gateway-state helpers"
Candidate issue #4523: "Sandbox gateway timeout on first connect"

Search matched on "gateway." But the PR is a pure refactor (no behavior change), and the issue is about timing. **Classification:** UNRELATED.

## Decision rule

If the LLM cannot cite a specific PR diff line **and** a specific issue symptom that map to each other, the answer must be UNRELATED. This prevents hallucinated matches.
