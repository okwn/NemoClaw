# Resumable State

A 9-stage pipeline can span hours. If the conversation gets compacted, the runtime crashes, or the user pauses overnight, the skill MUST be able to resume from the last completed stage without restarting Stage 1.

**State file:** `/tmp/issue-autopilot-<issue#>.state.json`

**Schema:**

```json
{
  "schema_version": 1,
  "issue_number": 3259,
  "repo": "NVIDIA/NemoClaw",
  "started_at": "2026-05-14T17:00:00Z",
  "last_updated": "2026-05-14T18:42:00Z",
  "last_completed_stage": 6,
  "stages": {
    "1_selection": { "completed_at": "...", "picked_issue": 3259, "score": 4.3 },
    "2_scope": { "completed_at": "...", "verdict": "in-scope", "docs_anchor": "docs/manage-sandboxes/runtime-controls.md" },
    "3_repro": { "completed_at": "...", "method": "synthetic-docker", "evidence_path": "/tmp/repro-3259.log" },
    "4_implementation": { "completed_at": "...", "files_touched": ["src/lib/..."], "lines_added": 47, "lines_removed": 3, "branch": "fix/3259-..." },
    "5_pr": { "completed_at": "...", "pr_number": 3499, "pr_url": "https://..." },
    "6_self_review": { "completed_at": "...", "acceptance_map_path": "/tmp/3259-acceptance.md", "gaps_fixed": [] },
    "7_ci": { "completed_at": null, "last_check": "...", "failing_checks": [], "pre_existing_flakes": [] },
    "8_cr_fix": { "completed_at": null, "rounds": [], "open_critical": 0 },
    "9_ready": { "completed_at": null }
  },
  "halts": [
    { "stage": 4, "at": "...", "reason": "max-files breach", "user_resolution": "approve-override" }
  ]
}
```

**Write protocol:**

- At every stage transition, OVERWRITE the state file atomically: `cat > /tmp/issue-autopilot-<N>.state.json.tmp && mv ... .state.json`
- Never partial-write. Atomic rename is the only safe pattern.
- Include the conversation-derivable fields (verdicts, file lists, paths) — NOT raw diff content (that's reconstructible from `git diff`).

**Read protocol on resume:**

1. If `--resume <N>` is passed AND `/tmp/issue-autopilot-<N>.state.json` exists, load it.
2. Print a summary table of completed-vs-pending stages, ask the user to confirm: "Resume from Stage <last_completed + 1>?"
3. On confirm, rehydrate any inferred state from disk (`git status` for branch, `gh pr view <pr>` for CI/CR state).
4. Re-run any incomplete in-flight stage from the beginning of that stage (not from mid-stage) — stages must be idempotent per-execution.
5. If `--resume <N>` is passed but the state file is missing, halt and tell the user "no checkpoint found for #<N>".

**Cleanup:** when Stage 9 completes (READY FOR HUMAN REVIEW), do NOT delete the state file. Keep it around for postmortem/audit. The maintainer can `rm /tmp/issue-autopilot-*.state.json` periodically.

**Validation pass on resume:** After rehydrating, verify the world hasn't moved underneath the checkpoint:

- Branch in state file still exists locally (`git rev-parse --verify <branch>`) — if missing, halt
- PR in state file still open (`gh pr view <N> --json state`) — if merged/closed, halt and ask user how to proceed
- Issue in state file still open (`gh issue view <N> --json state`) — if closed, surface and ask whether to discard the run

## Hard rules (these never bend)

1. **One ticket per run.** No "while we're here" scope creep — extras go in `PROACTIVE-LOG.md`.
2. **Read scope before scoring.** `CLAUDE.md` (Project Overview + Architecture), `docs/` index, `.agents/skills/` audience buckets. Reject issues outside the documented surface.
3. **Reproduce or refute before fixing.** If you can't reproduce in <10 min (synthetic or actual), surface that and halt — bug reports with stale paths or impossible repros (#2757 was a case) get a comment, not a PR.
4. **Tests-first.** Acceptance criteria → test case → implementation → loop until green. Per Karpathy "goal-driven execution."
5. **Stop at every externally-visible step.** Open PR, push, label, close issue, post comment — confirm with user first.
6. **Identity check before commit.** Verify `git var GIT_AUTHOR_IDENT` matches the maintainer running the skill (not a stub like `Test User <test@example.com>` from a leftover local `.git/config` override) AND commit signing is configured (`%G?` = `G` after a test commit). Halt if either fails. Recovery: `git config --local --unset user.name && git config --local --unset user.email` so the global identity takes over; verify with `git var GIT_AUTHOR_IDENT`.
