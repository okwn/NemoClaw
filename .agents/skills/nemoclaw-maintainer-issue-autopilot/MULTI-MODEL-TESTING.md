# Multi-model test plan — issue-autopilot

## Models in scope

| Model | Check |
|---|---|
| Claude Haiku 4.5 | Does Haiku follow the 9-stage gate order without skipping Stage 0 / Stage 9? |
| Claude Sonnet 4.6 | Does Sonnet correctly persist resumable state at every stage transition? |
| Claude Opus 4.7 (1M) | Does Opus avoid pre-emptively scoping out the user's confirmation steps? |

## Pass criteria

- Stage 0 local-branch precheck always runs first; surfaces any in-flight work
- Stage 9 perfect-match audit halts READY_FOR_REVIEW until every clause maps to evidence
- Resumable state file is atomic-renamed (never partial-written)
- Identity check rejects 'Test User' fallbacks before any commit
- Confirms at every externally-visible step (open PR, push, label, close, post)

## Known risks

- Haiku may interpret Stage 9 as optional ("if perfect-match, ship"); strengthen wording to "MUST PASS BEFORE READY".
- Sonnet may skip Stage 0 if no in-flight work is obvious; require it to run unconditionally.
- Opus may compress Stage 2 scope validation into a one-line claim ("looks in scope"); enforce the 5 explicit checks.

## How to run

Use a sandboxed git repo for eval runs; verify state files appear at each stage transition. The --resume flag should rehydrate state correctly.
