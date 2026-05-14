---
name: nemoclaw-maintainer-quick-wins
description: Ranks open PRs by blended merge-readiness × impact × staleness, runs a two-lens judgment chain (Scope/Coverage + Sequencing), then a Karpathy review lens, then tiered local testing. Resolves reviewer slots from .github/CODEOWNERS with reviewer-load awareness. Produces a verdict (APPROVE / REQUEST_CHANGES / BLOCK / RESHAPE / SEQUENCE / CLOSE-AS-SUPERSEDED) plus a draft PR comment and, for APPROVE, a draft RFR. Use when looking for the next PR to review, when the queue feels overwhelming, or when prioritizing visibility throughput. Local-only by default — drafts only, never posts.
user_invocable: true
---

# Quick-Wins Workflow

Find the close-to-done + high-impact work in the open PR queue, run a disciplined review pass, produce a verdict + RFR for each candidate. Optimized for visibility throughput — shipping user-visible fixes fast — without dropping the coverage-first discipline.

**Local-only by default.** Nothing it produces gets posted to GitHub automatically. All draft comments / RFRs / commits stay in the conversation until the maintainer copies them out.

## Configuration

The skill reads two optional config values from the repo root or `~/.config/<your-tool>/quick-wins.yml`:

```yaml
# Names tagged in RFR drafts — adjust to your team's reviewers
reviewer_handles:
  - "@your-scope-reviewer"
  - "@your-sequencing-reviewer"
# Slack/chat channel or DM where RFRs land (informational only — the skill never posts)
rfr_target: "#your-pr-review-channel"
```

If config is missing, RFR drafts use placeholders `${REVIEWER_A}` / `${REVIEWER_B}` so the maintainer can paste the right names manually.

## Invocation

```text
/nemoclaw-maintainer-quick-wins
```

Flags:

| Flag | Default | Meaning |
|------|---------|---------|
| `--mode A\|B\|C\|D\|E` | `D` | A merge-ready, B security-impact, C bug-fix-priority-high, D blended, E issue-first (ease × impact). Combinable: `--mode D,E` |
| `--top N` | `10` | How many candidates to rank |
| `--confirm-tier-3` | `on` | Ask before spending tier 3 (cloud e2e) budget |
| `--no-issues` | `off` | Skip mode E even if requested (default for PR-first review) |

## Workflow steps

Execute in order. Halt and report if a stage blocks.

1. **Selection** — fetch open PRs (and optionally issues), score, present top-10 table with reason columns.
2. **Wait for user pick** — user selects 3–5 candidates for the deep pass.
3. **Heavy-metadata fetch** — per finalist: full diff, PR body, CI status, mergeStateStatus, files, review decision. Split from bulk fetch because GraphQL 502s on heavy fields in large queries.
4. **Same-fix-already-merged check** — for each candidate PR, search merged PRs in the last 14 days whose title has high token overlap. If found → verdict `CLOSE-AS-SUPERSEDED`, skip further stages.
5. **Judgment chain (two-lens)** — see `JUDGMENT-CHAIN.md`. Scope/Coverage Lens + Substrate Sequencing Lens. Fail-fast.
6. **Karpathy lens** — see `KARPATHY-LENS.md`. Applied only to judgment-chain survivors.
7. **Tiered testing** — see `TIERED-TESTING.md`. Tier 3 (cloud e2e) gated on user confirmation.
8. **Verdict + outputs** — per PR: verdict, full analysis inline, draft PR comment (<30 lines), draft RFR (APPROVE only), status-ledger update.
9. **Salvage prompts** — for BLOCK verdicts where gap is small, offer local commit (never pushed).

## Scoring

### Mode D — PR blended

```text
merge_readiness = 1.0
  + (status:rebase ? -1.5 : 0)
  + (status:needs-info ? -1.0 : 0)
  + diff_bonus       # +1.0 if ≤20, +0.7 if ≤100, +0.4 if ≤500, +0.1 if ≤1000, else 0

impact = 0.5
  + (priority: high ? 3 : 0)
  + (priority: medium ? 1 : 0)
  + (security ? 3 : 0)
  + (bug ? 1 : 0)
  + (fix ? 0.5 : 0)
  + (enhancement: feature ? -0.5 : 0)

staleness_bump = min(age_days / 14, 1.0)
score = max(merge_readiness, 0.1) × max(impact, 0.1) × (1 + staleness_bump)
```

### Mode E — issue ease × impact (only if user enables)

See `ISSUE-MODE.md` if present in your repo's skill dir; otherwise this mode is parked.

### Implementation

Use `gh` CLI with lightweight fields only for the bulk list. Fetching heavy fields in bulk 502s on large repos.

**Lightweight bulk fetch (works):**

```bash
gh pr list --repo <owner>/<repo> --state open --limit 500 \
  --json number,title,author,labels,createdAt,additions,deletions,isDraft \
  > /tmp/qw_prs.json
```

**Fields that cause GraphQL 502 in bulk (fetch per-finalist only):**
`mergeStateStatus`, `statusCheckRollup`, `files`, `body`.

The jq scoring script is in this SKILL.md's "Mode D scoring" section, inlined rather than split out — the command is short enough to paste.

## Verdicts

| Verdict | When | Produces |
|---------|------|----------|
| `APPROVE` | Passes all stages, tests pass, no regressions | Draft comment + RFR |
| `REQUEST_CHANGES` | Minor fixable issues (missing test, small UX, docs) | Draft comment only, salvage prompt if small |
| `BLOCK` | Coverage failure on risky area, or unresolvable concerns | Draft comment only |
| `RESHAPE` | Scope grab-bag — extra unrelated changes in the diff | Draft comment asking to revert extraneous changes |
| `SEQUENCE` | Too big / needs substrate-first splitting (extract → test → fix) | Draft comment proposing the split |
| `CLOSE-AS-SUPERSEDED` | Same fix already merged | Draft close comment with link to superseding PR |

## RFR format

Only produced for `APPROVE` verdicts. Brief and impact-first.

**Reviewer resolution (auto, via CODEOWNERS):**

Before drafting the RFR, resolve the reviewer slots dynamically by intersecting the PR's changed files with `.github/CODEOWNERS`. This avoids hardcoded handles and tags the correct owners for *this specific PR*.

```bash
# 1. Locate CODEOWNERS (try standard paths)
OWNERS_FILE=""
for p in .github/CODEOWNERS docs/CODEOWNERS CODEOWNERS; do
  [ -f "$p" ] && OWNERS_FILE="$p" && break
done

# 2. Get changed files for the PR
gh pr view <PR> --repo NVIDIA/NemoClaw --json files --jq '.files[].path' > /tmp/qw-files.txt

# 3. For each file, find the last-matching CODEOWNERS pattern (GitHub spec: last wins)
#    and aggregate owners by file-count
python3 - <<'PY' > /tmp/qw-owners.txt
import re, fnmatch, collections
owners_lines = [l.strip() for l in open("$OWNERS_FILE") if l.strip() and not l.startswith("#")]
patterns = [(line.split()[0], line.split()[1:]) for line in owners_lines]
counts = collections.Counter()
for f in open("/tmp/qw-files.txt"):
    f = f.strip().lstrip("/")
    matched = None
    for pat, owners in patterns:  # last-match-wins
        # GitHub CODEOWNERS pattern semantics: prefix /foo/ matches everything under foo/
        gh_pat = pat.lstrip("/")
        if gh_pat.endswith("/"):
            if f.startswith(gh_pat): matched = owners
        elif gh_pat == "*":
            matched = owners
        elif fnmatch.fnmatch(f, gh_pat) or f == gh_pat:
            matched = owners
    if matched:
        for o in matched: counts[o] += 1
for owner, n in counts.most_common(3):
    print(f"{owner}\t{n}")
PY

# 4. Read top-2 (or top-3 if security-relevant area) into ${REVIEWER_A} / ${REVIEWER_B}
REVIEWER_A=$(awk 'NR==1{print $1}' /tmp/qw-owners.txt)
REVIEWER_B=$(awk 'NR==2{print $1}' /tmp/qw-owners.txt)
```

If `CODEOWNERS` is missing, or resolution returns zero owners, fall back to repo-configured defaults from the `Configuration` section above, or to the placeholders `${REVIEWER_A} ${REVIEWER_B}` for the maintainer to fill manually.

**Team-handle note:** GitHub CODEOWNERS may use team handles (e.g. `@NVIDIA/nemoclaw-security`) instead of individuals. Team handles are PREFERRED in the RFR because GitHub auto-pings every team member; never expand them to individuals unless the team is empty or the maintainer specifically asks.

**Reviewer-load awareness (hardening):**

Before locking the RFR slots, check how many OPEN review-requests the resolved team already has. Routing a 5th PR to a team that's already sitting on 4 unread RFRs guarantees the queue keeps growing. Threshold + fallback:

```bash
LOAD_THRESHOLD=${QW_LOAD_THRESHOLD:-5}
for team in "$REVIEWER_A" "$REVIEWER_B"; do
  [ -z "$team" ] && continue
  team_slug="${team#@}"
  open_count=$(gh search prs --repo NVIDIA/NemoClaw --state open \
    --review-requested "$team_slug" --json number 2>/dev/null \
    | jq 'length' 2>/dev/null || echo 0)
  if [ "$open_count" -ge "$LOAD_THRESHOLD" ]; then
    echo "⚠ $team already has $open_count open review-requests (≥ $LOAD_THRESHOLD threshold)."
    echo "  Consider routing to the third-choice team from /tmp/qw-owners.txt, or splitting the RFR."
  fi
done
```

If both resolved teams are at or over threshold, the skill should:

1. Surface the load + recommended fallback to the maintainer
2. Either route to the third-most-loaded team (read row 3 of `/tmp/qw-owners.txt`), or
3. Recommend the maintainer self-review or wait until queue drains

Never silently route to an over-loaded team — explicit surfacing lets the maintainer decide. Configurable via `QW_LOAD_THRESHOLD` env var (default 5).

**Template:**

```text
<REVIEWER_A> <REVIEWER_B> RFR: <PR-URL>
<one-line problem-or-attack closed>. <closing signal>.
```

**Rules:**

- Lead with the impact (attack closed, user-visible fix, unblocked signal). Not implementation details.
- Close with a compressed risk/effort signal: `small, tested` / `two-line fix, covered` / `one-file change`.
- Match the maintainer's house tone (lowercase / formal / etc.) — the skill carries no opinion on this.
- No line counts, file paths, test counts, CI status — those live on the PR page.

**Example (auto-resolved from CODEOWNERS for a `nemoclaw-blueprint/policies/` change):**

```text
@NVIDIA/nemoclaw-security @NVIDIA/nemoclaw-maintainer RFR: https://github.com/NVIDIA/NemoClaw/pull/2290
blocks a first-run symlink attack on ~/.nemoclaw that would hijack credential writes. small, tested.
```

## Status ledger

Maintain a running markdown table across the whole session:

| PR | Verdict | Stage | Notes |
|----|---------|-------|-------|
| [#NNNN](url) | verdict | e.g. "Awaiting admin merge" | one-line context |

Update after every verdict. Include GitHub URLs as markdown links on every row.

## JSON sidecar output

Every run writes a structured sidecar to `/tmp/nemoclaw-skill-output-quick-wins-<run_id>.json` that other skills (most usefully `acceptance-audit`) can consume.

**Envelope:** shared maintainer-skill schema (see `find-already-fixed/SKILL.md` for the spec).

**Per-result shape:**

```json
{
  "pr": 3284,
  "url": "https://github.com/NVIDIA/NemoClaw/pull/3284",
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "BLOCK" | "RESHAPE" | "SEQUENCE" | "CLOSE-AS-SUPERSEDED",
  "score": 4.85,
  "reviewers_resolved": ["@NVIDIA/nemoclaw-security", "@NVIDIA/nemoclaw-maintainer"],
  "reviewers_source": "CODEOWNERS" | "config" | "placeholder",
  "judgment_chain": { "scope_lens": "PASS", "sequencing_lens": "PASS" },
  "karpathy_findings": { "hidden_assumptions": [], "simpler": null, "surgical": null, "missing_tests": [] },
  "tiers_run": ["1", "2"],
  "tier_results": { "tier1": { "pass": 142, "fail": 0 }, "tier2": "skipped" },
  "linked_issue": 3277,
  "draft_pr_comment": "...",
  "rfr_draft": "@NVIDIA/nemoclaw-security @NVIDIA/nemoclaw-maintainer RFR: ..."
}
```

`next_skill_hint` points to `nemoclaw-maintainer-acceptance-audit --pr <pr>` when verdict is APPROVE and the PR has a `Closes #N` link — so the maintainer can chain a literal-clause audit before merge.

## Output discipline

Every verdict produces **two** outputs, kept separate:

1. **Full analysis inline in conversation** — findings tables, file:line refs, test output. For maintainer decision-making.
2. **Draft PR comment** — ≤30 lines. For the contributor. Kept in conversation, **never posted** by this skill.

Plus, for APPROVE: a **draft RFR blurb** for chat/Slack.

Never merge (1) and (2) into one wall of text.

## Halt conditions (the non-obvious one)

- **Three consecutive non-APPROVE verdicts in a row** — selection criteria are mis-calibrated. Pause and ask whether to widen the selection / re-run Mode D scoring with different weights, instead of grinding through more non-fits.

Generic halts (user-stop, API errors >3, destructive-action gating) are assumed.

## Proactive status log

See `PROACTIVE-LOG.md` in this skill directory.

**Working rule:** do the **minimum** needed to close the active ticket. Any idea larger than the minimum fix — refactors, substrate moves, generalizations, "while we're here" improvements — goes in the log, not the active PR.

**Pull from the log when:**

- User asks "what should I work on?" and the standard candidate pool is thin.
- User explicitly asks for something innovative / proactive / principal-engineer-grade.
- Between tickets, as idle-time investment.

**Entry lifecycle:** drop in → picked up → move to "Graduated" section with issue/PR link. Stale after 60 days triggers re-eval.
