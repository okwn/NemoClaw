# Multi-model test plan — ci-flake-triage

## Models in scope

| Model | Check |
|---|---|
| Claude Haiku 4.5 | Does Haiku correctly fetch the failing log tail and parse the test name? |
| Claude Sonnet 4.6 | Does Sonnet apply diff-overlap + main-history checks in the documented order? |
| Claude Opus 4.7 (1M) | Does Opus auto-elevate chronic flakes correctly when the history threshold fires? |

## Pass criteria

- Failing test correctly identified from log; file:line surfaced
- Diff-overlap check uses git diff --name-only origin/main..PR_HEAD (not the PR's branch alone)
- Main-history check uses gh run list --workflow=<name> --branch=main --limit=5
- Auto-elevation to INFRASTRUCTURE fires at >=7 hits in 14 days (read from /tmp/flake-history.jsonl)
- Infrastructure signatures matched verbatim (docker daemon, 502/503, ENETUNREACH, runc create failed)

## Known risks

- Haiku may skip the multi-rerun check if there's only one failed run; document the fallback ("with one rerun, lean on diff-overlap").
- Sonnet may forget to append to /tmp/flake-history.jsonl. Make the append step a hard rule.
- Opus might over-investigate (read 500 lines of log); enforce the --fetch-logs 50KB max.

## How to run

Synthesize 3 failing-check scenarios (PR_CAUSED, PRE_EXISTING_FLAKE, INFRASTRUCTURE) and verify each verdict.
