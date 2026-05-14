---
name: nemoclaw-maintainer-close-superseded-issues
description: Closes a batch of superseded issues with evidence-bearing comments and audit trail. Reads a JSON sidecar (typically from `find-already-fixed` or `scope-issues`) and applies a 3-step sequence per issue — assignee, evidence comment, close with reason — gated by per-rule preflights (priority+QA confirm, recent-external-comment skip, race-with-other-maintainer handling). Use when a detection skill surfaces candidates for closure and the maintainer wants to execute them in batch with audit log to `~/.nemoclaw/close-audit.jsonl`. Local-only.
---

# Close Superseded Issues

Action skill that takes a list of issues (typically from `nemoclaw-maintainer-find-already-fixed`) and **performs the GitHub-visible close action** for each: assignee, comment, close. Separates the action from detection so the dry-run safety of `find-already-fixed` stays clean.

## Why this matters

When the open-issue queue contains many already-fixed tickets, the noise:

- Pollutes selection for `issue-autopilot` and `quick-wins` (top candidates turn out to be already-fixed, wasting maintainer attention)
- Misleads reporters (they don't know the fix shipped)
- Confuses dependency-pinning + release prep (issues counted as "open" inflate the v0.0.X release blocker count)

Closing them with evidence-bearing comments shrinks the noise AND notifies the reporter the fix is live.

## Invocation

```text
/nemoclaw-maintainer-close-superseded-issues #N1 #N2 #N3
```

Or with a file argument:

```text
/nemoclaw-maintainer-close-superseded-issues --from /tmp/find-already-fixed-output.json
```

Flags:

| Flag | Default | Meaning |
|------|---------|---------|
| `--assignee` | `@me` (resolves via `gh api user --jq .login`) | Add as assignee (the maintainer running the close) |
| `--reason` | `completed` | `gh issue close --reason` value (`completed` or `not_planned`). Per-issue override read from the sidecar's `suggested_close_reason` field when present. |
| `--from <path>` | `(per-issue)` | Path to a JSON sidecar from `find-already-fixed` / `scope-issues`. Reads `results[].issue`, `results[].draft_close_comment`, and (when present) `results[].suggested_close_reason`, `results[].top_category`, `results[].requires_user_confirm`. |
| `--confirm` | `on` | Require explicit user OK before EACH close action |
| `--revival-only` | `off` | For sidecar rows where `top_category == STALE_NO_REPRO`, post the revival comment but do NOT close. Schedules the close for 14 days later (via a follow-up invocation). Use when chaining from `scope-issues`. |
| `--include-categories` | `(all)` | Comma-separated subset of `top_category` values to act on. E.g. `--include-categories DUPLICATE,UPSTREAMED` to skip OUT_OF_SCOPE/WONTFIX rows that need more deliberation. |

## Workflow

1. **Parse inputs.** Accept a comma/space-separated list of `#N` issue numbers, OR a JSON sidecar via `--from`.
2. **For each issue, fetch state.** Confirm it's still open (skip if already closed).
3. **Verify evidence.** If a comment draft isn't supplied (no sidecar AND no per-issue draft file), halt and tell the user to run a detection skill first (`find-already-fixed` or `scope-issues`).
4. **Resolve per-issue close-reason.** Precedence: sidecar's `suggested_close_reason` for the row > `--reason` flag value > `completed` default. (Lets a mixed batch close some as `completed` and others as `not_planned`.)
5. **Revival-only branch.** If `--revival-only` is set AND the row's `top_category == "STALE_NO_REPRO"`, post the revival comment but skip the close step. Record the row's intended close-date (revival_ts + 14d) in the JSON sidecar this skill emits so a follow-up invocation can pick it up.
6. **Per-issue gate.** Display:
   - Issue title + URL
   - Current assignees
   - Draft comment to be posted
   - Close reason (or "revival-only, scheduled close on <date>")
   - `requires_user_confirm` value from the sidecar (if `true`, never batch-confirm; always per-issue)
   Ask user to confirm (or batch-confirm all when no row has `requires_user_confirm: true`).
7. **Execute the 3-step sequence** for each confirmed issue (or 2-step for `--revival-only`):

   ```bash
   gh issue edit <N> --repo NVIDIA/NemoClaw --add-assignee <user>
   gh issue comment <N> --repo NVIDIA/NemoClaw --body "<comment>"
   # If not --revival-only:
   gh issue close <N> --repo NVIDIA/NemoClaw --reason <reason>
   ```

8. **Verify per-issue.** After each close, `gh issue view <N> --json state,assignees,closedAt` to confirm state transition. Surface any failures (e.g. issue was concurrently closed by someone else — accept that and move on, log the racing-close).
9. **Audit log every action** to `~/.nemoclaw/close-audit.jsonl` (one JSON line per issue). See "Audit log" section below.
10. **Final summary.** Markdown table of closed issues with link, evidence pointer, comment timestamp.

## Audit log (hardening — postmortem recoverability)

Every close-or-revival action appends one line to `~/.nemoclaw/close-audit.jsonl`. The maintainer can `jq` over it to answer questions like "did I wrongly close anything in Q1?" or "how many revival-only comments did I post in March?"

**Append rule:** atomic line-append, no overwriting of past entries. Use `>> ~/.nemoclaw/close-audit.jsonl`. Create the directory on first run via `mkdir -p ~/.nemoclaw`.

**Line schema:**

```json
{
  "ts": "2026-05-14T18:42:00Z",
  "run_id": "<uuid>",
  "issue": 3274,
  "issue_url": "https://github.com/NVIDIA/NemoClaw/issues/3274",
  "action": "closed" | "revival_only" | "skipped_already_closed" | "raced_close_with_comment_only" | "error",
  "category": "ALREADY_FIXED" | "DUPLICATE" | "OUT_OF_SCOPE" | "UPSTREAMED" | "STALE_NO_REPRO" | "WONTFIX_BY_DESIGN" | null,
  "close_reason": "completed" | "not_planned" | null,
  "evidence_pointer": "PR #3268 / src/lib/...:L34",
  "runner": "<gh-handle>",
  "source_sidecar": "/tmp/nemoclaw-skill-output-find-already-fixed-<run_id>.json",
  "reverted_at": null,
  "revert_reason": null
}
```

**Recoverability fields:** `reverted_at` and `revert_reason` are null on initial append; if the maintainer later reopens the issue, the skill (or a tiny helper) should look up the prior audit line by issue number and update those two fields in place. (`jq` can't edit-in-place — use `jq + sponge` or a Python one-liner.)

**Postmortem queries:**

```bash
# All closes in the last 30 days
jq -c "select((.ts | fromdateiso8601) > (now - 2592000))" ~/.nemoclaw/close-audit.jsonl

# Anything wrongly closed (later reverted)
jq -c "select(.reverted_at != null)" ~/.nemoclaw/close-audit.jsonl

# Close-rate by category — useful for tuning detection-skill thresholds
jq -s 'group_by(.category) | map({category: .[0].category, count: length})' ~/.nemoclaw/close-audit.jsonl
```

The audit log is local-only; never committed. The path is fixed (no `--audit-log` flag) to keep it discoverable for postmortems.

## Hard rules (each backed by a machine-checkable preflight)

### Rule 1 — Never close without an evidence-bearing comment

**Preflight:**

```bash
# Caller must supply a non-empty comment per issue. Reject the run if missing.
[ -s "/tmp/c${ISSUE}.md" ] || { echo "BLOCKED: no comment draft for #${ISSUE}"; exit 1; }
```

No bare `gh issue close` calls. Reporters deserve to know why.

### Rule 2 — `priority: high` + `NV QA` requires per-issue confirm

**Preflight:**

```bash
labels=$(gh issue view "$ISSUE" --repo NVIDIA/NemoClaw --json labels -q '[.labels[].name] | join(",")')
if echo "$labels" | grep -q "priority: high" && echo "$labels" | grep -q "NV QA"; then
  echo "  ⚠ #$ISSUE is priority:high + NV QA — needs per-issue confirm."
  read -p "  Close anyway? [y/N] " ans
  [ "$ans" = "y" ] || { echo "BLOCKED"; continue; }
fi
```

Those carry release-tracking weight; an accidental close costs the QA team time to re-verify and re-open. (`#3280` closed today fell in this bucket — the user's batch-OK satisfied per-issue intent, but the explicit check should run.)

### Rule 3 — Skip if external (non-maintainer) comment in last 24h

**Preflight:**

```bash
last_comment=$(gh api repos/NVIDIA/NemoClaw/issues/"$ISSUE"/comments \
  --jq 'sort_by(.created_at) | last | {age_h: ((now - (.created_at | fromdateiso8601))/3600 | floor), author: .user.login, association: .author_association}')
# Block if last comment is <24h AND author_association != MEMBER/OWNER/COLLABORATOR
age_h=$(echo "$last_comment" | jq .age_h)
assoc=$(echo "$last_comment" | jq -r .association)
if [ "$age_h" -lt 24 ] && ! echo "MEMBER OWNER COLLABORATOR" | grep -qw "$assoc"; then
  echo "BLOCKED: #$ISSUE last comment by external $assoc <24h ago — issue may not be settled"
  continue
fi
```

External activity within 24h signals the issue may not be settled.

### Rule 4 — Assignee defaults to runner; override per invocation

`--assignee <maintainer-handle>` records who stewarded the close. Resolve dynamically at skill start: `gh api user --jq .login`. Override only when audit-trail attribution should differ from the user who invoked the skill.

### Rule 5 — Surface "already closed by someone else" gracefully

The close-step can race with another maintainer's close. If `gh issue close` returns `is already closed`, treat as success and STILL post the evidence comment (audit trail). #3418 hit this race today; the skill correctly handled it by posting the comment after the race.

## JSON sidecar output

Every run writes a structured sidecar to `/tmp/nemoclaw-skill-output-close-superseded-issues-<run_id>.json` for audit-trail and chaining.

**Envelope:** same shared schema as the rest of the maintainer skill suite (see `find-already-fixed/SKILL.md` for the full envelope spec).

**Per-result shape:**

```json
{
  "issue": 3274,
  "url": "https://github.com/NVIDIA/NemoClaw/issues/3274",
  "action": "closed" | "revival_only" | "skipped_already_closed" | "skipped_user_declined" | "raced_close_with_comment_only" | "error",
  "assignee_added": "<gh-handle>",
  "comment_id": "4448304200",
  "comment_url": "https://...",
  "close_reason": "completed" | "not_planned" | null,
  "source_category": "ALREADY_FIXED" | "DUPLICATE" | "OUT_OF_SCOPE" | "UPSTREAMED" | "STALE_NO_REPRO" | "WONTFIX_BY_DESIGN" | null,
  "scheduled_close_at": "<iso8601 | null — only set when action=revival_only>",
  "closed_at": "<iso8601 | null>",
  "evidence_pointer": "PR #3268 / file:line"
}
```

When `--from <file>` is used, the input file is the JSON sidecar produced by `find-already-fixed` or `scope-issues`. This skill reads:

- `results[].issue` — required
- `results[].draft_close_comment` (or `results[].categories[].draft_close_comment` for scope-issues' multi-category shape) — required
- `results[].suggested_close_reason` — per-row override for `--reason`
- `results[].top_category` — drives `--revival-only` branch + audit-trail `source_category`
- `results[].requires_user_confirm` — disables batch-confirm for this row

## Output discipline

Per closed issue:

```text
✓ #NNNN closed (now state=CLOSED, assignees=[<maintainer-handle>], comment-id=<gh-comment-id>)
   evidence: <merged-sha> + <file>:<lines>
```

Per failed/skipped issue:

```text
⚠ #NNNN skipped — was already closed by @<user> at <time>
```

Final summary table with URLs.

## Halt conditions (the non-obvious ones)

- **Permission error on assignee-add** — the maintainer doesn't have write access to the reporter's issue meta. Surface the specific error so the maintainer knows whether to escalate, not just retry. (Happens occasionally on cross-org issues.)
- **>10 issues queued without batch-confirm** — likely a careless batch; pause and ask whether to proceed.

## Hard nos

- Action skill only. No detection — chain from `find-already-fixed` or `scope-issues`. No reopens (if a close was wrong, the maintainer reopens manually). No label changes beyond assignee.

## Race outcome reference

Concurrent close by another maintainer between detection and close → treat as success: still post the evidence comment (audit trail), record `action: raced_close_with_comment_only`, move on. The comment is the durable artifact; the close-state isn't.
