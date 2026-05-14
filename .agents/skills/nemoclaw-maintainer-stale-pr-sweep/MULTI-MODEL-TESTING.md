# Multi-model test plan — stale-pr-sweep

## Models in scope

| Model | Check |
|---|---|
| Claude Haiku 4.5 | Does Haiku apply the 6 classification rules in first-match-wins order? |
| Claude Sonnet 4.6 | Does Sonnet split heavy fields (mergeStateStatus, statusCheckRollup) per-PR? |
| Claude Opus 4.7 (1M) | Does Opus correctly run the reviewer-OOO check via gh api users/login/events? |

## Pass criteria

- READY_TO_MERGE fires only when reviewDecision=APPROVED AND CI green AND mergeable
- NEEDS_REBASE checks mergeStateStatus=DIRTY OR BEHIND (not just OUT_OF_DATE)
- WAITING_REVIEW requires CI green AND >24h since reviewer-request
- Reviewer-OOO check surfaces the "no public activity >7d" warning + CODEOWNERS-fallback recommendation
- Never auto-closes ABANDONED PRs; revival comment first

## Known risks

- Haiku may collapse WAITING_REVIEW + ABANDONED into "stale" generic. Enforce the 6 distinct buckets.
- Sonnet may try to bulk-fetch heavy fields; the SKILL.md's "Fields that cause GraphQL 502 in bulk" warning may need stronger framing.
- Opus might dismiss the reviewer-OOO heuristic as unreliable; emphasize it's a suggestion, not auto-action.

## How to run

Use the live NemoClaw open-PR queue; compare classification output against a manually-curated ground-truth list for ~20 PRs.
