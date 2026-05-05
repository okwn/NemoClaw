---
name: nemoclaw-maintainer-pr-comparator
description: Autonomously compares multiple open PRs targeting the same issue and picks the best one to merge. Runs gates + correctness + quality + comparative scoring with a deterministic verdict. Use when an issue has two or more competing PRs and you need to decide which to merge. Trigger keywords - compare prs, pick pr, which pr, duplicate prs, competing prs, pr decision, best pr for issue.
user_invocable: true
---

# Autonomous PR Comparator

Picks the best PR for a given issue from multiple open candidates. Walks every candidate through plumbing gates, correctness checks, code-quality checks, and comparative scoring. Outputs a deterministic verdict with reasoning trace.

Designed for company-wide use. Every check earns its place — Tier 0 is mandatory plumbing, Tiers 1-2 are 1% clever signals, Tier 3 is the deterministic decision mechanism.

## Prerequisites

- `gh` (GitHub CLI) installed and authenticated
- You're in a GitHub repository, or you specify `OWNER/REPO`
- An issue number with two or more open PRs that reference it

## Step 1: Parse the issue

```bash
gh issue view <issue-number> --json title,body,comments
```

Extract acceptance criteria into a checklist. Read the body **and every comment** — commenters often add asks the body doesn't capture (e.g., "and don't break Y while you're at it").

Output: structured checklist of criteria the winning PR must address.

## Step 2: Find candidate PRs

For the given issue, find all open PRs that are candidates:

```bash
# PRs that reference the issue
gh pr list --state open --search "linked:issue type:pr <issue-number>" --json number,title,author,headRefName,baseRefName

# Fallback: token-overlap search if no direct refs
gh pr list --state open --search "<issue-title-tokens>" --json number,title
```

Plus optionally:

- PRs with the same scope label as the issue
- PRs touching files mentioned in the issue's reproducer
- PRs with title token overlap

Dedupe and produce a candidate set.

## Step 2.5: Supersession detection

Before scoring, parse each candidate's body for explicit supersession:

- `supersedes #NNN`
- `replaces #NNN`
- `closed in favor of #NNN`
- `closes #NNN` (when #NNN is another open PR, not an issue)
- `folds in #NNN`

If a candidate references another candidate, the referenced one is **deprioritized**. In a happy-path tiebreaker tie, the superseding PR wins regardless of first-mover ordering. In degraded mode, the referenced PR's distance-to-ready is treated as infinite (it's been declared replaced).

This catches the "stalled PR replaced by fresh version" pattern — the older PR won't merge even if it has a better first-mover position, because the author has already declared a successor.

## Step 3: Run Tier 0 — gates (any fail = eliminated)

For each candidate PR, fetch the full state:

```bash
gh pr view <pr-number> --json number,title,state,headRefOid,statusCheckRollup,mergeable,mergeStateStatus,reviewDecision,reviews,comments,files,baseRefName,body
```

Check each gate:

1. **PR state is OPEN.** `state: OPEN` (not `CLOSED` or `MERGED`). A closed PR cannot merge regardless of score; it must be eliminated immediately. **(This is a hard kill — even degraded mode skips closed PRs.)**
2. **CI green on latest head SHA.** Confirm `statusCheckRollup` shows green for the *latest* head SHA — not a stale ancestor before a force-push.
3. **Mergeable, no conflicts, base ref current.** `mergeable: MERGEABLE` and `mergeStateStatus: CLEAN`.
4. **Branch protection satisfied.** Required reviewers approved (CODEOWNERS), DCO sign-off present, all required hooks ran.
5. **CodeRabbit threads resolved.** Zero unresolved threads from CodeRabbit's review. Use `gh api repos/<owner>/<repo>/pulls/<pr>/comments` and inspect resolution state.

If gate 1 (`state: OPEN`) fails, the PR is removed from the candidate set entirely — not even degraded mode considers it. For gates 2-5, mark the PR as failing Tier 0 but keep it in the set; degraded mode handles all-failed cases.

## Step 4: Run Tier 1 — correctness (six 1%-clever checks)

For each candidate PR, run all six. Record evidence (file:line) and a pass/yellow/fail verdict per check.

### 4.1 Test exercises bug path

Read each new/modified test in the diff. For each, verify the test's assertions would have *failed* on the pre-fix code.

```bash
gh pr diff <pr-number> | grep -A 50 "^+++ b/.*\.test\."
```

Heuristic: test must (a) call the function/path the fix touched, (b) assert on output that depends on the fix. A test that just calls the function and checks "no exception thrown" doesn't exercise the bug path unless the bug *was* an exception.

### 4.2 Comment-as-spec coverage

Every acceptance criterion from the issue (body + comments) maps to a fix in the diff or a test. If any criterion has no diff/test mapping, flag.

### 4.3 Negative test coverage

The fix has tests for invalid/edge inputs, not just the happy path. Look for tests asserting on:

- Empty / null / undefined inputs
- Boundary values (0, max, min)
- Type confusion (string where number expected)
- Malformed input

If the fix is for a bug class that has obvious negative cases, those negative cases must be tested.

### 4.4 Coverage shape

Every new code path in the diff has a test. Use the file's test counterpart and check that new branches/functions are exercised. A new `else` branch with no test = yellow.

### 4.5 Refactor-vs-behavior scan

If the PR claims `refactor` / `rename` / `extract` / `move`, the diff must be net-zero in:

- Conditional adds (`if`, `?`, `&&`, `||`)
- New `throw new Error(`
- Changed `process.exit(` codes
- Changed return values

Net-positive in any of these = hidden behavior change inside what claims to be a refactor.

### 4.6 Mocking purity

Tests must isolate *external* dependencies (network, filesystem, time, randomness), not replace the unit under test. If a test for `validateInput()` mocks `validateInput()`, the test proves nothing.

## Step 5: Run Tier 2 — code quality (three 1%-clever checks)

### 5.1 Description-vs-diff drift

Every touched file must be named or implied by the PR description's "Changes" section. Files outside the stated scope = "while I'm here" tweak = yellow.

### 5.2 Migration completion

If the PR adds a new path (oclif version, v2 helper, replacement function), the old path's symbols must be (a) deleted in this PR, OR (b) linked to a follow-up PR in the body. Both surviving with no follow-up link = incomplete migration.

```bash
# Look for old path symbols still referenced after the diff
gh pr diff <pr-number> | grep -E "^-.*function\s+\w+|^-.*export\s+\w+"
# Then grep the post-PR codebase for those symbols
```

### 5.3 Public surface preservation

For any content *change* (not move) in:

- Flag definitions (`--name`, `Flags.<x>(`)
- Help/usage strings (`Usage:`, `description:`, `summary:`)
- Error messages (`throw new Error(`, `console.error`)
- Exit codes (`process.exit(`)

…the PR body must have a Notes section explaining the change, AND the corresponding `docs/` files must be updated. Pure moves (added in one file, removed in another with same content) are fine.

### 5.4 Workaround-vs-root-cause check

Grep the diff for symptom-suppression patterns:

- `try { ... } catch { /* empty or swallow */ }` blocks
- `catch (err) { return; }` with no rethrow or logging
- `if (err.code === '<errno>') return` (errno-specific silent ignores like EACCES, ENOENT, EEXIST)
- Defensive returns in error paths that hide the failure from callers

If any are added in the diff, the PR body must (a) link to a follow-up issue for the root-cause fix, OR (b) explain why the suppression is the correct behavior (e.g., "expected during shutdown, callers handle absence elsewhere"). Without (a) or (b) → yellow flag.

**Why this matters:** symptom-suppression hides bugs without fixing them. The same code can fail in production for a different reason and now no one sees it. Flagging this makes authors choose: real fix, justified suppression, or scheduled root-cause work.

## Step 6: Compute weighted score per PR

Score each PR across Tiers 1-2:

- Each pass = full points
- Each yellow = half points
- Each fail = zero

Weights (suggested defaults; tunable per repo):

- Tier 1 checks (correctness): 2.0× each
- Tier 2 checks (quality): 1.0× each

Total score = sum of weighted check results.

## Step 7: Compare and pick (Tier 3)

### Happy path — at least one PR passes all Tier 0 gates

Among Tier 0 survivors:

1. **Behavior-coverage matrix.** Build a table: rows = acceptance criteria (from Step 1), columns = surviving PRs, cells = covered/partial/missing. Note per-criterion winner.

2. **Apply tiebreakers in order:**
   - **Supersession**: any PR that references the other as superseded wins immediately (see Step 2.5)
   - Smaller diff (proportional to issue scope)
   - Better edge-case test coverage
   - Earlier PR (first-mover)
   - Author with higher merge ratio in this repo (compute: merged PRs / total PRs in the last 90 days)
   - Most recent activity (freshness — last commit recency)

3. **If still wash** → recommend "merge A, cherry-pick specific tests from B." Pick A by lowest PR number deterministically.

### Degraded mode — no PR passes all Tier 0 gates

1. **Classify each PR's Tier 0 failures:**
   - **Trivial** (auto-fixable): missing sign-off, missing issue link, stale base
   - **Substantive** (real work): CI red, mergeability conflicts, missing CODEOWNERS approvals, unresolved CodeRabbit threads

2. **Distance-to-ready ranking:**
   - Fewer substantive failures wins
   - Tie → fewer trivial failures wins
   - Tie → higher Tier 1-2 weighted score wins (correctness beneath the broken plumbing)

3. **Output:** Per-PR failure list, scorecard, "PR A is closer — fix [list]. PR B has [issues]." plus actionable salvage steps per PR.

## Step 8: Output the verdict

Produce a single deterministic report:

```markdown
## PR Comparison Verdict — Issue #<issue>

### Acceptance Criteria
- [ ] Criterion 1 (from body)
- [ ] Criterion 2 (from body)
- [ ] Criterion 3 (from comment by @user)

### Per-PR Scorecard

| Check | PR #A | PR #B |
|---|---|---|
| **Tier 0 — gates** | | |
| CI green (latest SHA) | ✅ | ❌ stale |
| Mergeable | ✅ | ✅ |
| Branch protection | ✅ | ✅ |
| CodeRabbit threads | ✅ | ⚠️ 2 unresolved |
| **Tier 1 — correctness** | | |
| Test exercises bug path | ✅ | ✅ |
| Comment-as-spec coverage | ✅ | ⚠️ misses ask 3 |
| Negative test coverage | ❌ | ✅ |
| ... | | |
| **Tier 2 — quality** | | |
| Description-vs-diff drift | ✅ | ✅ |
| Migration completion | ✅ | ⚠️ no follow-up link |
| Public surface preservation | ✅ | ✅ |
| **Weighted score** | 18.5 | 14.0 |

### Behavior Coverage Matrix

| Criterion | PR #A | PR #B |
|---|---|---|
| Empty input handling | ✅ | ✅ |
| Boundary check | ✅ | ❌ |
| Don't break Y (from comments) | ❌ | ✅ |

### Verdict: **MERGE PR #A**

Reasoning trace:
- PR #B failed Tier 0 (CI red on latest SHA after force-push at SHA abc1234)
- PR #A's score 18.5 vs B's 14.0
- PR #A misses "Don't break Y" — recommend cherry-picking B's test for it: `<file>:<line>`

### Suggested action

1. Merge PR #A
2. Cherry-pick test from PR #B at `tests/foo.test.ts:42-58` to cover criterion "Don't break Y"
3. Close PR #B with comment linking to #A and noting the cherry-pick

### Reasoning evidence
[file:line refs and diff snippets per judgment, for debugging if the skill misfires]
```

## Step 9: Reasoning-trace requirement

Every judgment in the scorecard must carry:

- **Evidence** — file:line refs, diff snippets, log excerpts
- **Reasoning** — the chain of logic from evidence to verdict
- **Score contributed** — how this judgment moved the weighted total

If the skill picks wrong, every misfire must be debuggable from the trace alone. No black-box decisions.

## What this skill does NOT do (v2 territory)

These checks would raise the ceiling further but require infrastructure beyond GitHub API + LLM:

- **Adversarial input simulation** — sandbox each PR, feed edge inputs from the issue, compare outputs
- **Cross-issue regression sweep** — search other open issues for symptoms this PR may also fix or break (separate skill: `nemoclaw-maintainer-cross-issue-sweep`)
- **Revert simulation** — dry-run `git revert` against neighbor PRs
- **Static analyzer integration** — CodeQL, Semgrep deep analysis
- **Substrate-fit judgment** at senior-eng quality
- **Test brittleness audit** — flag snapshots, magic numbers, time/FS/port-dependent tests
- **Bisect-friendliness** — commit history coherence

These are deferred to v2 modules and built only if v1 misses them in production.

## Composition with other skills

- `nemoclaw-maintainer-find-review-pr` finds duplicate PRs grouped by issue. Pipe its output into this skill.
- `nemoclaw-maintainer-cross-issue-sweep` (v2) runs cross-issue regression intel; this skill can call it as a sub-step to enrich Tier 1 with adjacent-fix and contradicting-fix signals.
- `nemoclaw-maintainer-security-code-review` is invoked separately for security-sensitive PRs and produces inputs to Tier 1 of this skill.

## Validation

Before trusting this skill in autonomous mode, run it retroactively against the last 50 merged PRs in the target repo. Two failure rates to watch:

- **False positive rate** — skill flags things competent reviewers would ignore. If >10%, sharpen LLM prompts in the offending tier.
- **False negative rate** — skill stamps a PR that later caused issues. If >5%, that's a candidate for a new check (likely v2 territory).

If both rates are within bounds on the backtest, ship to wider repo set.
