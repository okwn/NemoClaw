# 06_SELECTED_5_PR_PLAN.md — NemoClaw

## Overview
Selected 5 open PRs for analysis and potential backporting to the `okwn/NemoClaw` fork. Selection prioritizes security fixes, clear scoping, platform diversity, and PRs where the fork can practically add value.

## Selection Criteria
- **Security first**: Security-labeled PRs get priority
- **Bounded scope**: Prefer PRs with clear, reviewable diffs (not massive refactors)
- **Platform diversity**: Cover Linux, macOS, Jetson, and cross-platform scenarios
- **Fork value**: Areas where our fork can realistically test, validate, or extend
- **Freshness**: Post-May 2026 PRs with active review traction

---

## Selected PR 1: #4075 — `fix(policy): split Claude Code from permissive policies`

### Why Selected
Security-relevant policy fix. Removes Claude Code-specific egress from permissive sandbox policies and moves it behind an explicit opt-in preset. Fixes issue #4073. Clear problem/solution with well-labeled scope.

### Scope
| Metric | Value |
|--------|-------|
| Files | 39 |
| Additions | ~400+ |
| Deletions | ~200+ |
| Risk | Low — policy subsystem has good test coverage |
| Review complexity | Medium — policy YAML + TypeScript tests |

### Files Touched
```
agents/hermes/policy-permissive.yaml
agents/openclaw/policy-permissive.yaml
docs/reference/network-policies.mdx
docs/security/best-practices.mdx
nemoclaw-blueprint/policies/openclaw-sandbox-permissive.yaml
nemoclaw-blueprint/policies/presets/claude-code.yaml
test/policies.test.ts
(+ 32 policy/test files)
```

### Fork Action Plan
1. Create `fork/policy/claude-code-split` branch off `main`
2. Cherry-pick or apply the policy split changes
3. Run `npm test` (policy tests) to validate
4. Validate against existing permissive policy test fixtures
5. Test that `claude-code` preset needs explicit opt-in

### Verification
```bash
npm test -- --project=cli --grep="policy"
```

---

## Selected PR 2: #4054 — `fix(security): enforce owner-only permissions on ~/.nemoclaw directory and config files`

### Why Selected
High-priority security fix (labeled `security`, `priority: high`). Changes world-readable config (644) to owner-only (600/700) after onboard. Addresses issue #4009. Small, targeted, low risk.

### Scope
| Metric | Value |
|--------|-------|
| Files | 5 |
| Additions | 39 |
| Deletions | 4 |
| Risk | Very low — permission hardening only |
| Review complexity | Low — clear file-by-file change |

### Files Touched
```
src/lib/inference/local-adapter-lifecycle.test.ts
src/lib/inference/local-adapter-lifecycle.ts
src/lib/onboard.ts
src/lib/onboard/config-sync.test.ts
src/lib/onboard/config-sync.ts
```

### Fork Action Plan
1. Create `fork/security/permission-hardening` branch
2. Apply permission hardening in `config-sync.ts`
3. Verify `~/.nemoclaw` permissions are 700 after `nemoclaw onboard`
4. Validate on Linux (primary), test on macOS

### Verification
```bash
# After onboard, check permissions
stat -c "%a" ~/.nemoclaw
stat -c "%a" ~/.nemoclaw/config.json
# Expected: 700 and 600 respectively
```

---

## Selected PR 3: #4029 — `fix(installer): preserve npm lockfiles during install`

### Why Selected
macOS platform fix. Preserves npm lockfiles during install to prevent accidental overwrites. Clear bug with small scope. Good introduction to the installer subsystem.

### Scope
| Metric | Value |
|--------|-------|
| Files | 4 |
| Risk | Low — installer behavior change |
| Review complexity | Low — targeted file changes |

### Files Touched
```
.github/actions/basic-checks/action.yaml
scripts/install.sh
test/install-preflight.test.ts
test/lockfile-ci-guard.test.ts
```

### Fork Action Plan
1. Create `fork/installer/lockfile-preservation` branch
2. Apply lockfile preservation logic in `install.sh`
3. Run installer tests: `npm test -- --project=cli --grep="install"`
4. Validate lockfile is preserved on re-run

### Verification
```bash
npm test -- --project=cli --grep="lockfile"
```

---

## Selected PR 4: #4008 — `fix(onboard): use NVIDIA runtime for Jetson sandbox GPU`

### Why Selected
Platform-specific fix (Jetson AGX Thor/Orin). Uses NVIDIA container runtime instead of Docker default for GPU passthrough. Clear hardware context, well-scoped. Multiple test files provide good coverage signal.

### Scope
| Metric | Value |
|--------|-------|
| Files | 13 (12 test + 1 source) |
| Risk | Low — Jetson-specific path |
| Review complexity | Medium — GPU detection logic |

### Files Touched
```
src/lib/onboard.ts
src/lib/onboard/docker-gpu-patch.test.ts
src/lib/onboard/docker-gpu-patch.ts
src/lib/onboard/docker-gpu-sandbox-create.ts
src/lib/onboard/gateway-gpu-passthrough.test.ts
src/lib/onboard/gateway-gpu-passthrough.ts
src/lib/onboard/gpu-recovery.test.ts
src/lib/onboard/gpu-recovery.ts
src/lib/onboard/sandbox-gpu-mode.test.ts
src/lib/onboard/sandbox-gpu-mode.ts
src/lib/onboard/sandbox-gpu-preflight.test.ts
src/lib/onboard/sandbox-gpu-preflight.ts
```

### Fork Action Plan
1. Create `fork/onboard/jetson-nvidia-runtime` branch
2. Apply NVIDIA runtime selection in `sandbox-gpu-mode.ts`
3. Run GPU preflight tests: `npm test -- --project=cli --grep="gpu"`
4. Simulate Jetson detection via mock environment

### Verification
```bash
npm test -- --project=cli --grep="gpu"
# Validate runtime detection in CI
```

---

## Selected PR 5: #3980 — `fix(onboard): fail fast in preflight when all dashboard ports are occupied`

### Why Selected
UX improvement for onboarding. Onboard fails fast in preflight when all dashboard ports (18789-18799) are occupied. References issue #3953. Adds early validation with clear user-facing error.

### Scope
| Metric | Value |
|--------|-------|
| Files | 3 |
| Additions | 91 |
| Deletions | 4 |
| Risk | Low — adds early validation |
| Review complexity | Low — clear preflight logic |

### Files Touched
```
src/lib/onboard.ts
src/lib/onboard/dashboard-port.test.ts
src/lib/onboard/dashboard-port.ts
```

### Fork Action Plan
1. Create `fork/onboard/dashboard-port-preflight` branch
2. Apply port availability check in `dashboard-port.ts`
3. Run preflight tests: `npm test -- --project=cli --grep="dashboard"`
4. Validate failure message is clear and actionable

### Verification
```bash
npm test -- --project=cli --grep="dashboard"
```

---

## Summary Table

| PR | Title | Files | Risk | Platform | Priority |
|----|-------|-------|------|----------|----------|
| #4075 | fix(policy): split Claude Code from permissive policies | 39 | Low | All | Security |
| #4054 | fix(security): enforce owner-only permissions | 5 | Very Low | All | Security |
| #4029 | fix(installer): preserve npm lockfiles during install | 4 | Low | macOS | Medium |
| #4008 | fix(onboard): use NVIDIA runtime for Jetson sandbox GPU | 13 | Low | Jetson | Medium |
| #3980 | fix(onboard): fail fast in preflight when ports occupied | 3 | Low | All | Low |

---

## Execution Order

1. **#4054** (Security) — Smallest scope, highest priority. Start here.
2. **#3980** (UX) — Smallest change, clear feedback loop. Good second.
3. **#4029** (Installer) — Self-contained, easy to validate.
4. **#4008** (Jetson) — Larger but well-tested. Good for platform coverage.
5. **#4075** (Policy) — Largest scope, most files. Finish last with thorough review.

---

## Contributing Notes
1. **Conventional Commits**: All commits must follow `<type>(<scope>): <description>` format
2. **SPDX headers**: Required on all source files
3. **Biome linting**: Run `npm run check` before committing
4. **Tests**: Run `npm test` — plugin tests run in pre-commit
5. **DCO**: Sign off on commits (Developer's Certificate of Origin)
6. **CI**: PR checks include basic-checks, platform-vitest, Ollama proxy E2E
7. **Code Owners**: Check `CODEOWNERS` for relevant maintainers per subsystem