# Stage 9 — Acceptance Perfect-Match Gate

Before reporting READY FOR REVIEW, run an explicit **perfect-match audit** — no extra, no missing.

**A. Extract acceptance clauses — LITERAL, not paraphrased.** Parse the issue body for every clause under "Expected", "Acceptance", "Proposed change", "Test strategy", "Steps to Reproduce" (final-state expectations), and any numbered requirement. **For lists of items the issue calls out by name** (e.g. "for each commonly changed item (model, provider, policy preset, openclaw.json keys, agents.list, channel tokens, dashboard port, GPU passthrough, sandbox name, shields posture)"), each named item is its own clause. Use the verbatim name as the row title — do not paraphrase or group, because paraphrasing hides gaps (the #3501 audit shipped 17/18 because "openclaw.json keys" was matched against keyword "openclaw" instead of the literal phrase, missing it).

Each clause becomes a row in this table:

| # | Clause (verbatim from issue) | Evidence (file:line / test name / CI step) | Status |
|---|---|---|---|

`Status` ∈ `MET` / `MISSING` / `INTENTIONALLY_SKIPPED` (and justification if skipped).

**B. Scan the diff for surplus.** Run `git diff --name-only origin/main..HEAD` and for every changed file, confirm at least one acceptance clause traces to changes in that file. Any file whose changes don't map to a clause is **surplus** — either revert it or document why it's required (e.g. test infrastructure).

**C. Halt if either side fails:**

- Any `MISSING` clause → **do not report ready.** Fix or escalate.
- Any unjustified surplus → **revert** the surplus changes; if user confirms it's needed, document the "intentional extra" in the PR body.

**D. Final gate checklist (all must be ✅ to ship the READY message):**

- [ ] Every acceptance clause maps to evidence (MET or INTENTIONALLY_SKIPPED with note)
- [ ] No surplus files / lines that don't trace to a clause
- [ ] CI green OR only pre-existing flakes (verified against `main` runs)
- [ ] CodeRabbit has no open `Potential issue` flags
- [ ] Every commit's `%G?` = `G` and `git log --pretty=format:'%an <%ae>'` matches the real maintainer
- [ ] `npm run typecheck:cli` clean on the final state
- [ ] Targeted unit tests pass (the ones that map to acceptance clauses)
- [ ] PR labels intersect the issue's labels (confirmed with user)

**E. If all pass:** post **READY FOR HUMAN REVIEW** with the perfect-match table inline + a one-line RFR draft. **Stop.** Don't merge, don't request review, don't ping reviewers.

**Why this gate matters:** the #3265 → #3498 dry-run shipped two intermediate states (one missing the rename, one with token-store extraction that wasn't required) before settling on the perfect match. The user caught both by asking "does this match acceptance, nothing more nothing less?" — that question is now this gate's job to answer before claiming done.
