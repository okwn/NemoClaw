# 05_PR_CANDIDATES.md — NemoClaw

## Overview
Analyzed 473 open issues and 30+ open PRs. Identified PRs with clear scope, well-defined changes, and areas where community contributions are welcome.

## Selection Criteria
- **Clarity**: PR description clearly defines what/why/how
- **Scope**: Bounded, reviewable diff (not massive refactors)
- **Fit**: Areas where an external contributor can realistically make good changes
- **Freshness**: Prioritized recently opened (post-May 2026)
- **Priority**: Higher weight for bugs, security, and onboarding issues

---

## Candidate 1: #4075 — fix(policy): split Claude Code from permissive policies
- **Status**: Open, not draft
- **Labels**: `fix`, `policy`
- **Opened**: 2026-05-22
- **Branch**: `upstream/fix/policy-split-claude-code`
- **Summary**: Splits Claude Code handling out of permissive policies into a separate, explicit opt-in path
- **Why good candidate**: Clear security/policy fix. Small scope. Well-labeled. Affects policy subsystem which has good test coverage
- **Risk**: Low — targeted policy change
- **Files likely touched**: `nemoclaw-blueprint/policies/`, policy test files

## Candidate 2: #4054 — fix(security): enforce owner-only permissions on ~/.nemoclaw directory and config files
- **Status**: Open, not draft
- **Labels**: `security`, `fix`
- **Opened**: 2026-05-22
- **Branch**: `upstream/fix/security-permissions`
- **Summary**: Changes config file permissions from world-readable (644) to owner-only (600/700) after onboard
- **Why good candidate**: Security fix with clear problem/solution. High priority label. Affects credential safety
- **Risk**: Very low — adds permission hardening
- **Files likely touched**: `src/lib/credentials/`, `src/lib/state/`, onboarding flow

## Candidate 3: #4026 — fix(onboard): mention 'none selected skips' in messaging-channels prompt
- **Status**: Open, not draft
- **Labels**: `NemoClaw CLI`, `enhancement: ui`, `fix`, `v0.0.50`
- **Opened**: 2026-05-22
- **Referenced**: Issue #3471
- **Summary**: Adds clarification text to the messaging-channels onboard prompt explaining that selecting "none" causes the step to be skipped
- **Why good candidate**: Small UX improvement. Easy to understand. Low risk. Good for learning codebase
- **Risk**: Very low — UI copy change
- **Files likely touched**: `src/lib/onboard/` prompt text, potentially `nemoclaw/src/onboard/`

## Candidate 4: #4008 — fix(onboard): use NVIDIA runtime for Jetson sandbox GPU
- **Status**: Open, not draft
- **Labels**: `Platform: Jetson AGX Thor/Orin`, `NemoClaw CLI`, `fix`, `Sandbox`, `v0.0.50`
- **Opened**: 2026-05-21
- **Summary**: Uses NVIDIA container runtime instead of Docker default for Jetson sandbox GPU passthrough
- **Why good candidate**: Platform-specific fix with clear hardware context. Small scope. Good for learning GPU/sandbox path
- **Risk**: Low — Jetson-specific path
- **Files likely touched**: `src/lib/onboard/sandbox-gpu-mode.ts`, Docker/GPU detection

## Candidate 5: #4037 — fix(runtime): use prependSystemContext to prevent runtime instructions leaking into chat UI
- **Status**: Open, not draft
- **Labels**: `fix`, `enhancement: policy`
- **Opened**: 2026-05-22
- **Summary**: Uses prependSystemContext API to prevent runtime instructions from appearing in the chat UI on third message
- **Why good candidate**: Addresses issue #4019 (System runtime instructions leaking into chat UI on third message). Clear bug fix with observable behavior
- **Risk**: Low — uses existing API correctly
- **Files likely touched**: Runtime context handling, chat UI injection points

## Candidate 6: #4029 — fix(installer): preserve npm lockfiles during install
- **Status**: Open, not draft
- **Labels**: `Platform: macOS`, `NemoClaw CLI`, `fix`
- **Opened**: 2026-05-22
- **Summary**: Preserves npm lockfiles during install to prevent accidental overwrites
- **Why good candidate**: macOS installer fix. Clear problem. Small scope
- **Risk**: Low — installer behavior change
- **Files likely touched**: `scripts/install.sh`, Node.js version/path detection

## Candidate 7: #3979 — feature: nemoclaw <name> session export
- **Status**: Open (enhancement request with PR likely)
- **Labels**: `Getting Started`, `NemoClaw CLI`, `enhancement: inference`
- **Opened**: 2026-05-21
- **Summary**: Add command to export agent session JSONL + trajectory from running sandbox
- **Why good candidate**: New feature with clear CLI interface. Well-scoped. Good documentation value
- **Risk**: Medium — new command surface
- **Files likely touched**: `src/commands/`, state management for sessions

## Candidate 8: #3826 — docs(contributing): add newcomer contribution path
- **Status**: Open
- **Labels**: `documentation`, `good first issue`, `Getting Started`
- **Opened**: 2026-05-19
- **Summary**: Add newcomer contribution path and community expectations to CONTRIBUTING.md
- **Why good candidate**: "Good first issue" labeled. Pure documentation. Easy to validate
- **Risk**: Very low — documentation only
- **Files likely touched**: `CONTRIBUTING.md`

## Candidate 9: #3794 — docs(reference): document openshell settings + sandbox runtime env
- **Status**: Open
- **Labels**: `documentation`, `fix`
- **Opened**: 2026-05-19
- **Summary**: Document OpenShell settings and sandbox runtime environment variables
- **Why good candidate**: Clear documentation need. Well-scoped. Affects reference docs
- **Risk**: Very low — documentation
- **Files likely touched**: `docs/reference/`, possibly `fern/` docs

## Candidate 10: #3980 — fix(onboard): fail fast in preflight when all dashboard ports are occupied
- **Status**: Open, not draft
- **Labels**: `bug`, `NemoClaw CLI`, `fix`
- **Opened**: 2026-05-21
- **Referenced**: Issue #3953
- **Summary**: Onboard fails fast in preflight when all dashboard ports 18789-18799 are occupied
- **Why good candidate**: Clear bug with existing issue #3953. Pre-flight validation improvement
- **Risk**: Low — adds early validation
- **Files likely touched**: `src/lib/onboard/` preflight checks, port allocation

---

## Issues Worth Addressing (Potential PRs)

| Issue | Title | Labels | Why Address |
|-------|-------|--------|-------------|
| #3978 | [docs] Agent session JSONL / trajectory paths are stable but undocumented | `documentation`, `priority: high` | High-priority docs gap, clear scope |
| #3990 | [WSL2][Install] fresh install + onboard takes 25-30 min with no progress feedback | `bug`, `Getting Started`, `Platform: Windows/WSL` | UX improvement, parallelization opportunity |
| #3948 | [Brave Search][Policy&Network] Agent still claims no web access despite brave preset enabled | `bug`, `Getting Started`, `NV QA`, `Integration: Brave` | Policy/inference integration issue |
| #4015 | npm preset does not allow @openclaw/microsoft-speech to resolve from registry | `bug`, `NemoClaw CLI`, `NV QA`, `Platform: All` | Policy preset gap, clear fix |
| #4014 | pypi preset does not allow expected GET access to pypi.org/files.pythonhosted.org | `bug`, `NemoClaw CLI`, `NV QA`, `Platform: All` | Policy preset gap, clear fix |
| #3892 | docs: remove local flag from sandbox inference examples | `documentation`, `fix` | Docs cleanup, small scope |
| #3909 | docs: remove prompt markers from Windows setup commands | `documentation`, `Platform: Windows/WSL`, `fix` | Docs cleanup, small scope |

---

## Contributing Notes

1. **Conventional Commits**: All commits must follow `<type>(<scope>): <description>` format
2. **SPDX headers**: Required on all source files
3. **Biome linting**: Run `npm run check` before submitting
4. **Tests**: Run `npm test` — plugin tests run in pre-commit
5. **DCO**: Sign off on commits (Developer's Certificate of Origin)
6. **CI**: PR checks include basic-checks, platform-vitest, Ollama proxy E2E
7. **Reviewers**: Check CODEOWNERS for relevant maintainers