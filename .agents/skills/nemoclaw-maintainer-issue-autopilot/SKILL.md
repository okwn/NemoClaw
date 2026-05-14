---
name: nemoclaw-maintainer-issue-autopilot
description: Ships a minimum-scope PR end-to-end for the simplest in-scope NemoClaw issue. Runs nine stages with user gates — local-branch precheck, selection, scope check against repo docs, reproduce-or-refute, test-first implementation, PR open, batch self-review, CI watch, CodeRabbit fix loop, perfect-match acceptance gate. Resumable state via /tmp/issue-autopilot-<issue#>.state.json survives conversation breaks; identity check rejects 'Test User' fallbacks. Use when there's a clear in-scope ticket to ship, when the maintainer wants minimum-scope discipline enforced, or when resuming an interrupted issue→PR pipeline. Local-only — confirms at every externally-visible step.
---

# Issue Autopilot

Autonomous "issue → merge-ready PR" pipeline for NemoClaw. The goal is the absolute minimum work that closes one ticket cleanly, fully tested, with a PR body any onlooker can understand, then waits. **Local-only — exclude via `.git/info/exclude`.** All draft content lives in the conversation; user must confirm before any destructive or externally-visible action (PR open, force-push, label change, close).

## Invocation

```text
/nemoclaw-maintainer-issue-autopilot
```

Flags:

| Flag | Default | Meaning |
|------|---------|---------|
| `--top N` | `8` | Candidates to surface in selection |
| `--max-files N` | `5` | Auto-halt if implementation touches more files |
| `--max-lines N` | `300` | Auto-halt if added lines exceed this |
| `--watch-ci` | `on` | Stay in CI watch loop after PR opens |
| `--cr-fix-loop` | `on` | Fix CodeRabbit comments automatically (re-prompts on each cycle) |
| `--dry-run` | `off` | Stop after presenting verdict; don't open PR |
| `--resume <issue#>` | `off` | Resume an interrupted run from its last checkpointed stage. Skips Stage 1 (selection) entirely and rehydrates from the state file. |

## Resumable state

This skill writes a state file to `/tmp/issue-autopilot-<issue#>.state.json` after every stage so the run can resume after compaction / crash / pause. See [RESUMABLE-STATE.md](RESUMABLE-STATE.md) for the full schema and rules.

## Workflow stages (execute in order, halt on block)

> **Checkpoint reminder:** at the end of every stage, write the updated state file (`/tmp/issue-autopilot-<issue#>.state.json`) before moving to the next stage. Atomic rename only. See the "Resumable state" section above for the full schema. This is a hard rule — without checkpoints, the resume flag is useless.

### Stage 0 — Local-branch precheck (run before everything else)

Before pulling any candidate, scan local git state for in-flight work the maintainer may have forgotten about:

```bash
# Any branch with the candidate issue number in its name?
for issue in $CANDIDATE_ISSUES; do
  hits=$(git branch -a --list "*${issue}*" 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "  ⚠ existing branch(es) for #${issue}:"
    echo "$hits" | sed 's/^/      /'
  fi
done

# Any stash referencing the issue?
git stash list 2>/dev/null | grep -E "#?[0-9]+" | while read -r line; do
  echo "  ⚠ stash references issue(s): $line"
done

# Any uncommitted changes? Surface as a courtesy — the autopilot won't proceed
# from a dirty tree.
[ -n "$(git status --porcelain)" ] && echo "  ⚠ working tree dirty — commit or stash before Stage 4"
```

For any candidate that has matching local artifacts, surface them in Stage 1's selection table as a `local_artifacts` column. Two right actions when it fires:

1. **Resume that local work** — the maintainer may already be halfway through. Instead of starting fresh, invoke `--resume <issue#>` if a state file exists, or check out the existing branch and continue manually.
2. **Discard the local artifacts** — only after confirming with the maintainer. The skill never auto-deletes branches or stashes.

If a candidate has unresolved local artifacts and the maintainer doesn't confirm one of the two right actions, the skill **deprioritizes that candidate in the rank** (push to the bottom of the table). Don't auto-block — the maintainer might explicitly want to start fresh.

This catches the failure mode where you start a new run on #N, get to Stage 4, and discover you already have a `fix/N-half-done` branch from three days ago.

### Stage 1 — Selection

Fetch open issues with lightweight fields only:

```bash
gh issue list --repo NVIDIA/NemoClaw --state open --limit 200 \
  --json number,title,labels,createdAt,updatedAt,comments
```

Score candidates by **ease × impact × scope-fit × pr-state**, and surface **assigned-to-me** issues as a distinct top tier:

- **Ease (1-5):** small file count guess (from title/body), clear acceptance criteria, no `status: blocked` / `needs-info` / `wontfix` / `enhancement: feature` labels.
- **Impact (1-5):** `priority: high` (+3), `priority: medium` (+1), `security` (+2), `bug` (+1), `NV QA` (+1), high comment count on recent activity (+1).
- **Scope-fit (0-3):** must map to a clear path in `CLAUDE.md`'s Architecture table OR docs/. Out-of-scope = 0 and disqualifies.
- **PR-state (-3 to +1):** open PR exists and APPROVED/ready-to-merge → −3 (skip); open PR stale or red CI → 0 (still a candidate, escalate in Stage 2); no PR → +1.
- **Assignee (+5):** issue is assigned to the running user (resolve dynamically via `gh api user --jq .login` at skill start). Always surface in its own pinned section at the top of the table — it's explicitly someone's workload, ignoring it is wrong.

**Assigned-to-me discovery:**

```bash
gh issue list --repo NVIDIA/NemoClaw --state open --assignee @me --limit 200 \
  --json number,title,labels,createdAt,updatedAt,comments
```

Merge that result with the general candidate pool and label each row with `assignee=<your-handle>` or blank.

For each candidate, also surface in the table: `pr_state` column (`NO_PR` / `OPEN_<N>` with state hint) and `assignee` column. User picks with that info visible — they may explicitly want to take over an `existing-pr-needs-work` case OR take an assigned-to-me issue first.

Surface top-8 in a table with scope-fit + pr_state + assignee rationale per row, then **wait for user pick**.

### Stage 2 — Scope validation (deep)

For the picked issue, run these checks before any code work:

0. **Read every comment, not just the body.** Run `gh api repos/<owner>/<repo>/issues/<n>/comments --paginate` and parse each comment. Comments often contain:
   - Additional sub-bugs the reporter or others discovered after filing (e.g. #3456 comment 1 added "uninstall leaves residuals" as a 4th sub-bug not in the body)
   - Workarounds that hint at the real root cause
   - "Already-fixed in PR #N" notes (e.g. #3418 had a "fixed in #3367" comment that the autopilot missed by only reading the body)
   - Reproductions on more platforms that widen the test matrix
   The Stage 1 lightweight scan only reads the body — Stage 2 MUST enumerate sub-bugs from body + every comment together. If the combined sub-bug count or scope spans multiple subsystems, halt and ask the user to scope the picked work to ONE sub-bug.
1. **File paths cited still exist.** Grep the source for the file/line refs in the issue body. (Issue #3265 cited stale paths — caught via `find src/lib -name "local-inference*"`.)
2. **Repo policy match.** Does the fix area appear in `CLAUDE.md` § Architecture? In `docs/` somewhere? If neither, the issue is asking for a NEW surface — escalate.
3. **Already-fixed detection.** Three signals to check, any one triggers close-as-resolved:
   - **Label**: issue has `fixed-on-latest`, `done`, `status: resolved`, or `status: superseded`. (Caught #3115 in autopilot run 3 — the issue still listed `priority` and `bug` but the maintainer team had marked `fixed-on-latest` before closing.)
   - **Code grep**: search current `main` for the symptom or proposed fix. If the symptom no longer reproduces (e.g. #3418 claimed `nemoclaw/package.json` lacks a `test` script — but the script is already present on main), it's fixed.
   - **Recent merged PR titles**: `gh pr list --state merged --search "<issue#>"` — multiple merged PRs in the last 30 days referencing the issue strongly suggests it's been addressed in pieces (e.g. #3280 had 5+ merged commits before the autopilot would have picked it).

   Right action for any of these: **close-as-resolved** with a comment, not open a PR.
4. **Existing-PR triage.** Run `gh pr list --repo NVIDIA/NemoClaw --state open --search "<num> in:body"` AND title-substring search. For each hit, classify:
   - **READY_TO_MERGE** — PR diff covers every acceptance clause, CI green, has at least one approval (or `reviewDecision == "APPROVED"`). Action: **skip this issue**, don't duplicate effort. Surface the PR URL to the user as "already in flight".
   - **NEEDS_REBASE_OR_FINISH** — PR addresses the issue but has CI red, unaddressed CR comments, or has been stale >14 days. Action: ask user whether to (a) rebase and finish that PR, (b) leave it alone and pick a different issue.
   - **WRONG_DIRECTION** — PR is open but the diff doesn't actually solve the acceptance criteria (or solves the wrong sub-problem). Action: surface verdict to user; if they confirm, open a competing PR or comment on the existing one with the gap analysis.
   - **NO_PR** — clean, proceed.

   Do this BEFORE coding. The previous Stage 1 filter "exclude any issue referenced in an open PR" was too coarse — it killed valid cases where the existing PR is stalled.
5. **Acceptance criteria are testable.** If the issue says "should feel snappier" → halt, ask for measurable criteria.

Output a one-paragraph scope verdict (`in-scope` / `out-of-scope` / `needs-clarification` / `already-fixed` / `existing-pr-ready` / `existing-pr-needs-work`) and **wait for user confirmation** before coding.

### Stage 3 — Reproduce or refute

Cheap repro first — synthetic Docker container, a unit-test harness, or a one-line bash that demonstrates the bad behavior. ≤10 min budget. If you can't reproduce:

- The bug report may have stale paths or wrong root cause (#2757 case). Draft a "request more info" comment and **halt** — don't proceed to fix.
- If repro is fundamentally not possible without prod infrastructure, flag that and halt.

### Stage 4 — Test-first implementation

1. Write the failing test(s) that map to the acceptance criteria. ONE test per criterion. Mock external dependencies (curl, openshell exec, fs).
2. Implement the minimum code to make them pass.
3. **Hard halt** if `git diff --stat` exceeds `--max-files` or `--max-lines` — present the diff, ask the user whether to (a) trim scope, (b) approve overrun, or (c) abandon.
4. Run typecheck (`npm run typecheck:cli`) and relevant unit tests on touched files. Loop until green.
5. Never `--no-verify` or `SKIP=` hooks unless the user explicitly approves — known pre-existing flake patterns (5s testTimeout in unrelated files) are the only documented exception.

### Stage 5 — PR open (gated)

Draft the PR body with these sections — present to user, get OK before `gh pr create`:

- **Summary** — 1-2 lines of what changed.
- **Acceptance criteria mapping** — table: issue requirement → evidence (file:line / test name).
- **Behavior matrix** — for state-machine-like fixes, table of input → output.
- **Test plan** — exact commands to verify locally + manual repro steps.
- **Notes for reviewers** — anything not obvious from the diff.

**PR body style — read the team's house style.** Different teams have different preferences:

- Some teams want the PR body strictly technical (acceptance map, behavior matrix, test plan, reviewer notes) — plain-English analogies stay in conversation only, never in the public PR body.
- Other teams welcome plain-English / "explain this to a non-engineer" sections in the body to make the change accessible to non-developers reading the PR.

If the repo has a `CONTRIBUTING.md` PR template or the team has a documented house style, follow that. If not, default to **technical-only** — it's the lower-risk choice for cross-team review. Always confirm with the maintainer before opening the PR if you're not sure which mode applies.

Commit message: Conventional Commits, ends with the issue's `Closes #N`, signed-off-by, Co-Authored-By Claude.

After user OK, open PR + apply labels matching the issue's labels (intersect with repo's available labels). **Confirm label list with user before applying.**

### Stage 6 — Batch self-review

Apply the `nemoclaw-maintainer-quick-wins` lens to your own PR:

- **Two-lens judgment chain** (Scope/Coverage Lens + Sequencing Lens) — see `quick-wins/JUDGMENT-CHAIN.md`. Fail-fast.
- **Karpathy lens** — see `quick-wins/KARPATHY-LENS.md`. Simplicity, surgical, goal-driven.
- **Acceptance criteria 1:1 map** — every clause in the issue's "Expected" / "Acceptance" / "Proposed change" section must trace to a line in the PR diff OR an explicit "intentionally skipped because…" note.

Report findings inline. If self-review surfaces a gap, fix it and add another commit BEFORE proceeding to CI watch.

### Stage 7 — CI watch + flake triage

```bash
gh pr view <N> --repo NVIDIA/NemoClaw --json statusCheckRollup,reviewDecision,mergeStateStatus
```

For each failing check:

- **Pre-existing flake on `main`?** Verify with `gh run list --workflow=<name> --branch=main --limit=5`. If yes, note in conversation, do NOT attempt to fix.
- **Caused by this PR?** Drop into fix-then-recommit.

Do not poll faster than every 60s. Use `Monitor` for "tell me when CI settles" if supported.

### Stage 8 — CodeRabbit fix loop

Fetch CR comments:

```bash
gh api repos/NVIDIA/NemoClaw/pulls/<N>/comments --paginate
```

For each comment severity:

| Severity | Action |
|---|---|
| Critical / Major | Auto-fix, present diff for user OK, push as `fix(scope): address CodeRabbit feedback on #NNNN` |
| Minor / Nit | Batch into one comment fix-up commit at the end |
| Question / Suggestion (no `Potential issue` flag) | Draft a reply for user to optionally post; do NOT auto-fix |

After each round, re-run Stage 6 (batch self-review) on the updated PR to confirm acceptance still maps and nothing regressed.

### Stage 9 — Acceptance perfect-match gate + Wait

Before reporting READY FOR REVIEW, run an explicit literal-clause audit (substring → all-tokens-within-K=4 → fail) plus a surplus-file check, then a final 8-item gate checklist. Halt on any MISSING clause or unjustified surplus. See [STAGE-9-ACCEPTANCE-GATE.md](STAGE-9-ACCEPTANCE-GATE.md) for the complete spec.

## Halt conditions (these are the ones that aren't obvious)

- **Three consecutive CR comments on the same file** — strong signal Stage 2's scope was wrong; abort and re-scope rather than thrash through fixups.
- **CodeRabbit flags a `Critical` requiring architectural rethink** — stop. Architectural rethink in Stage 8 means Stage 4 missed something fundamental; reopen scope.
- **CI red on a check this PR caused AND the fix isn't obvious in one commit** — same logic. One-commit fix = continue; n-commit fix loop = the PR is wrong.

Generic halts (user says stop / can't reproduce / breach `--max-files` / identity check fails) are assumed.

## Hard nos

- No human-review bypass. No rebase / force-push outside the maintainer's explicit per-invocation request. No scope expansion ("extras → PROACTIVE-LOG.md, separate ticket"). No fixing pre-existing flakes inside this run.

## JSON sidecar output

In addition to the resumable state file documented above, the skill writes a final-result sidecar at run completion: `/tmp/nemoclaw-skill-output-issue-autopilot-<run_id>.json`.

**Envelope:** shared maintainer-skill schema (see `find-already-fixed/SKILL.md`).

**Per-result shape (single object — one run, one issue):**

```json
{
  "issue": 3259,
  "issue_url": "https://...",
  "pr": 3499,
  "pr_url": "https://...",
  "branch": "fix/3259-...",
  "stages_completed": [1, 2, 3, 4, 5, 6, 7, 8, 9],
  "halts": [],
  "scope_verdict": "in-scope",
  "acceptance_audit_path": "/tmp/nemoclaw-skill-output-acceptance-audit-<run_id>.json",
  "ci_final_state": "success" | "flake-noted" | "red",
  "cr_rounds": 2,
  "state_file": "/tmp/issue-autopilot-3259.state.json",
  "ready_for_review_at": "<iso8601>"
}
```

Sub-skills invoked during the run (`quick-wins`, `acceptance-audit`, `ci-flake-triage`) write their own sidecars; this skill records pointers to them in the per-stage fields above.

## Trust-but-verify (the non-obvious ones)

- **"Test passes locally" ≠ "CI will pass."** Always rebuild `dist/` before running vitest against compiled output. Local stale `dist/` masks regressions.
- **"Issue body says line N" ≠ "line N is still there."** Refactors move things. Grep before assuming.
- **"CodeRabbit says X is broken" ≠ "X is broken."** CR agents hallucinate deletions that never existed (seen on PR #3295 — claimed ~120 LoC of GPU helpers deleted; never existed on main). Always verify CR claims against `git show main:<path>`.
- **"DCO passed" ≠ "author identity is right."** DCO checks the `Signed-off-by` trailer string match, not name. Check `git log --pretty=format:'%h %an <%ae>'` before push — the `Test User` failure mode that produced Stage 0's identity check passed DCO and still shipped 4 wrong-author commits.
