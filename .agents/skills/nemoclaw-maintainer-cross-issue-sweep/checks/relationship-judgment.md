# Relationship Judgment

How the LLM classifies each candidate issue. The judgment is the only non-deterministic step in the pipeline; everything else is mechanical search.

## Contents

- Inputs to the LLM
- The prompt
- Evidence requirement
- Confidence levels
- Reverse-link boost

## Inputs to the LLM (per candidate)

- PR diff (truncated to 3000 chars if larger)
- PR description body
- PR's primary linked issue number (for context — used by SAME_ISSUE_DIFF check)
- Candidate issue number, title, body (truncated to 2000 chars)
- Candidate issue's first ~5 comments (for symptom context)

## The prompt

```text
Judge whether this PR's changes affect the open issue.

PR #{pr_number}: {pr_title}
PR description: {pr_body}
PR diff (relevant slice): {diff}

Candidate issue #{issue_number}: {issue_title}
Issue body: {issue_body}

PR's primary linked issue: #{primary_issue}

Classify the relationship:

- ADJACENT_FIX: PR's changes likely also resolve this issue
- CONTRADICTING: PR's approach makes this issue's desired behavior impossible
- SAME_ISSUE_DIFF: same root bug as #{primary_issue} (dedupe filter)
- UNRELATED: no meaningful relationship

For ADJACENT_FIX or CONTRADICTING, REQUIRED:
- Cite specific PR diff line(s) (file:line)
- Cite specific issue symptom(s) (issue line or quote)
- Confidence: high / medium / low

If you cannot cite specific evidence, answer UNRELATED.
```

## Evidence requirement (anti-hallucination)

The LLM must cite a specific PR diff line and a specific issue symptom for any ADJACENT_FIX or CONTRADICTING verdict. Without citations, the answer must be UNRELATED.

This rule is the single most important defense against hallucinated matches. Without it, token-overlap noise dominates.

## Confidence levels

- **high**: clear semantic match between cited PR change and cited issue symptom
- **medium**: plausible match but partial evidence (e.g., the change touches the right area but doesn't directly fix the cited symptom)
- **low**: weak inference; below the default `confidence_floor` from `repo-policy.md` and gets dropped

## Reverse-link boost

If the candidate issue's body or comments already mention this PR's number (e.g., "fixed by PR #2851"), the relationship is already in someone's mental model. Boost confidence one tier:

- low → medium (rescues a borderline match)
- medium → high (cements a likely match)
- high → unchanged (already at ceiling)

Implementation: after the LLM's classification, the orchestrator checks the candidate issue body and comments for the PR number. If found, applies the boost.

## Why this beats naive token-overlap

Naive token-overlap finds candidates but produces high false-positive rates. Two filters separate signal from noise:

1. **LLM judgment** distinguishes "function name appears in issue" from "function's behavior is what the issue describes"
2. **Evidence requirement** forces the LLM to commit to specific lines, not vague hand-waving

The reverse-link boost handles the case where humans have already noticed the relationship — that's strong prior signal the skill should respect.
