# Multi-model test plan — close-superseded-issues

## Models in scope

| Model | Check |
|---|---|
| Claude Haiku 4.5 | Does Haiku correctly read the sidecar and apply per-row close_reason overrides? |
| Claude Sonnet 4.6 | Does Sonnet halt for per-issue confirm on `priority: high + NV QA` rows? |
| Claude Opus 4.7 (1M) | Does Opus avoid over-explaining the 3-step sequence and just execute? |

## Pass criteria per eval

- Reads the input sidecar correctly (issue, draft_close_comment, suggested_close_reason, top_category, requires_user_confirm)
- Honors all 5 hard rules with their machine-checkable preflights
- On race-with-other-maintainer: posts comment, sets action=raced_close_with_comment_only, continues
- For STALE_NO_REPRO + --revival-only: posts revival comment, sets scheduled_close_at, NEVER closes
- Audit log appended at ~/.nemoclaw/close-audit.jsonl for every action

## Known risks

- Haiku might skip the priority+QA preflight if it's not in a "you must" framing. Strengthen the rule wording from "requires per-issue confirm" to "MUST halt and prompt per issue".
- Sonnet might not surface the audit-log path to the maintainer; ensure the final summary table mentions it.
- Opus is usually fine; watch for any over-reasoning about whether to close vs revival.

## How to run

Generate a synthetic sidecar input from the evals/*.json. Verify the audit log matches the expected actions.
