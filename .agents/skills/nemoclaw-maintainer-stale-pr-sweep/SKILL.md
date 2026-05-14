---
name: nemoclaw-maintainer-stale-pr-sweep
description: Classifies stale open PRs into READY_TO_MERGE / NEEDS_REBASE / WAITING_CI / WAITING_REVIEW / ABANDONED / UNCLEAR with per-bucket recommended actions. Detects reviewer-OOO via GitHub events feed and recommends CODEOWNERS-fallback redistribution. Use when the open-PR queue feels stuck, when a weekly sweep is due, or when triaging which stale PRs the maintainer should unblock next. Pairs with `pr-rebase-assist` for the NEEDS_REBASE bucket. Local-only.
---

# Stale PR Sweep

Companion to `nemoclaw-maintainer-quick-wins` (which scores PRs by impact). This skill classifies PRs by **why they're not moving** so the maintainer can pick what to unblock.

## Why this matters

Open PRs that sit untouched for >14 days fall into predictable categories. Each category has a different right-action:

- `WAITING_REVIEW` — ping reviewer or self-review
- `WAITING_CI` — investigate why CI hasn't run / completed
- `NEEDS_REBASE` — author or maintainer rebase + push
- `ABANDONED` — author hasn't responded to comments, close-as-stale
- `READY_TO_MERGE` — has approval + green CI, just merge

Lumping them together (which the standard "stale PR" lists do) makes the queue look intimidating. Sorted by category, most of them resolve in <5 min each.

## Invocation

```text
/nemoclaw-maintainer-stale-pr-sweep
```

Flags:

| Flag | Default | Meaning |
|------|---------|---------|
| `--days N` | `14` | Stale threshold |
| `--top N` | `20` | Maximum PRs to surface |
| `--include-drafts` | `off` | Whether to include draft PRs (usually skip) |
| `--exclude-labels` | `dependabot,security automation` | Skip bot-authored or auto-managed PRs |

## Classification rules (apply in order, first match wins)

1. **`READY_TO_MERGE`** — `reviewDecision = APPROVED` AND CI green AND mergeable. The PR is unblocked; merge it (or surface to admin).
2. **`NEEDS_REBASE`** — `mergeStateStatus = DIRTY` OR `BEHIND` (rebase against main needed). Often blocks reviewers from approving.
3. **`WAITING_CI`** — CI has any check `IN_PROGRESS` or `QUEUED` for >2h. Either flake, queue contention, or stuck workflow.
4. **`WAITING_REVIEW`** — `reviewDecision = REVIEW_REQUIRED` AND CI green AND PR has been ready >24h. Reviewer assigned but hasn't responded.
5. **`ABANDONED`** — author last commented >30 days ago, has unanswered review comments, no recent commits.
6. **`UNCLEAR`** — doesn't fit any of the above. Surface for manual triage.

## Workflow

1. **Fetch open PRs.** Lightweight bulk fetch — number, title, author, updatedAt, isDraft, labels.
2. **Filter by `--days N`** — keep only PRs whose `updatedAt` is older than the threshold.
3. **Heavy per-PR fetch.** For each candidate: `mergeStateStatus`, `reviewDecision`, `statusCheckRollup`, last comment timestamps, last commit timestamp. Skip drafts unless `--include-drafts`.
4. **Apply classification rules in order.**
5. **Per-row action draft.** For each PR, propose the next-step action:
   - `READY_TO_MERGE` → "Merge via admin; ping author if not auto-merged"
   - `NEEDS_REBASE` → "git rebase origin/main && force-push, or invoke `pr-rebase-assist` to walk it interactively"
   - `WAITING_CI` → "Check workflow run; rerun if stuck"
   - `WAITING_REVIEW` → "Ping reviewer; if reviewer is OOO (see hardening below), redistribute to CODEOWNERS fallback"
   - `ABANDONED` → "Comment asking for revival within 14d, else close-as-stale"
5a. **Reviewer-OOO check (hardening — applies only to `WAITING_REVIEW`).** Before recommending "ping reviewer," verify the reviewer's recent activity:

   ```bash
   for pr_num in $WAITING_REVIEW_PRS; do
     reviewer=$(gh pr view "$pr_num" --repo NVIDIA/NemoClaw --json reviewRequests \
       --jq '.reviewRequests[0].login // .reviewRequests[0].name // ""')
     [ -z "$reviewer" ] && continue
     # Resolve team → fallback to first team member if a team is requested
     # Check last 7 days of public activity for the user
     last_activity_iso=$(gh api "users/${reviewer}/events?per_page=10" \
       --jq '.[0].created_at // ""' 2>/dev/null)
     if [ -n "$last_activity_iso" ]; then
       last_activity_days=$(( ($(date -u +%s) - $(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$last_activity_iso" +%s 2>/dev/null || echo 0)) / 86400 ))
       if [ "$last_activity_days" -gt 7 ]; then
         echo "  ⚠ reviewer @$reviewer last active $last_activity_days days ago — likely OOO"
         # Resolve fallback from CODEOWNERS (excluding the OOO reviewer's team)
         echo "    Recommended: redistribute to fallback team from .github/CODEOWNERS"
       fi
     else
       echo "  ⚠ no public activity found for @$reviewer (may be private profile or OOO)"
     fi
   done
   ```

   Replace the row's recommended action with the redistribution suggestion when the OOO check fires. Surface a separate `WAITING_REVIEW_OOO` bucket in the output report so the maintainer can see at-a-glance which PRs are stuck on an inactive reviewer vs. just waiting normally.

   **Caveats:** GitHub's events feed only shows PUBLIC activity. Private contributions don't appear. So "7+ days no public activity" is a heuristic, not proof of OOO — surface it as suggestion, never as auto-action.

6. **Output report.** Markdown table grouped by classification with per-row action.
7. **Optional batch actions.** If the user OKs, the skill can:
   - Comment "/rebase" or rebase + push for `NEEDS_REBASE` cases (gated: user-confirmed per PR)
   - Post a stale-revival comment on `ABANDONED` cases (gated: user-confirmed per PR)
   - Trigger workflow rerun for `WAITING_CI` cases (gated)
8. **Stop.** Never auto-close PRs. Never auto-merge.

## JSON sidecar output

Writes `/tmp/nemoclaw-skill-output-stale-pr-sweep-<run_id>.json`. `quick-wins` can consume this to weight stale PRs in the impact ranker; `issue-autopilot` Stage 2.4 can consume to detect "existing PR in flight, abandoned" cases.

**Envelope:** shared maintainer-skill schema (see `find-already-fixed/SKILL.md`).

**Per-result shape:**

```json
{
  "pr": 2105,
  "url": "https://github.com/NVIDIA/NemoClaw/pull/2105",
  "title": "feat(onboard): add Tavily",
  "author": "<gh-handle>",
  "classification": "ABANDONED" | "READY_TO_MERGE" | "NEEDS_REBASE" | "WAITING_CI" | "WAITING_REVIEW" | "UNCLEAR",
  "last_activity_days": 67,
  "linked_issue": null,
  "recommended_action": "Comment asking for revival within 14d, else close-as-stale",
  "draft_action_comment": "..."
}
```

## Output discipline

```text
=== Stale PR sweep (last 14d, 23 PRs found) ===

READY_TO_MERGE (3):
| #     | Title | Author | Last update |
|-------|-------|--------|-------------|
| #NNNN | <one-line title> | <author> | Nd ago |
| ...

NEEDS_REBASE (5):
| ... |

WAITING_REVIEW (8):
| #     | Title | Reviewer | Days since reviewer-request |
| ...

ABANDONED (4):
| ... |

WAITING_CI (2):
| ... |

UNCLEAR (1):
| ... |
```

## Reference cases (NemoClaw open-PR queue, 2026-05)

A live sweep produced this bucket distribution. PR numbers preserved.

- **READY_TO_MERGE:** #3499 (dashboard bind 0.0.0.0, CI green + APPROVED, 1d old). Action: ping admin merge.
- **NEEDS_REBASE:** PR with 90-day-old base — `mergeStateStatus = BEHIND` and conflicts on `package-lock.json`. Action: invoke `pr-rebase-assist`; `--auto-stage-clean` handles the lockfile.
- **WAITING_REVIEW:** #3284, #3241, #3351, #3433 — all `reviewDecision = REVIEW_REQUIRED`, CI green, 1-2d old. Action: ping the assigned reviewer; if reviewer-OOO check fires, redistribute to CODEOWNERS fallback.
- **ABANDONED:** #2105 (`feat(onboard): add Tavily`, author last activity >60d). Action: post a 14-day revival comment via `close-superseded-issues --revival-only`.
- **WAITING_CI:** PR with a workflow stuck in QUEUED state for 4+ hours. Action: re-trigger; if it still queues, surface to platform owners.
- **UNCLEAR:** PR with a single failed required check, no review-decision, mixed state. Action: surface for manual triage.

## Halt conditions (the non-obvious ones)

- **>3 batch actions queued (rebase pushes, revival comments, rerun triggers)** — pause and ask. Batch destructive actions are easy to mis-target.

## Hard nos

- No merges, no auto-close on abandoned PRs (revival comment first, then `close-superseded-issues` if no response after grace period), no rebase + force-push without explicit per-PR confirmation.

## Bucket-shape reference

- **`WAITING_REVIEW` for >24h with CI green** → the reviewer has the ball. Ping or redistribute. The reviewer-OOO check (above) tells which.
- **`ABANDONED` with >60d author silence** → revival comment first; chain `close-superseded-issues --revival-only` if no reply within 14d.
- **`NEEDS_REBASE` AND `BEHIND` only (no DIRTY)** → safe to invoke `pr-rebase-assist` directly; mechanical rebase, low conflict risk.
- **`NEEDS_REBASE` AND `DIRTY`** → there are conflicts. `pr-rebase-assist` walks them, but expect maintainer involvement per file.
