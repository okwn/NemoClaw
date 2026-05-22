# 00_STATE.md — NemoClaw

## Repository Info
- **Upstream**: `NVIDIA/NemoClaw`
- **Fork**: `okwn/NemoClaw` (cloned to `/root/oss-pr-campaign/repos/NemoClaw`)
- **Default branch**: `main`
- **Language**: TypeScript
- **Archived**: No
- **License**: Apache-2.0

## Upstream Stats
- Stars: 20,596 | Forks: 2,714 | Open Issues: 473 | Watchers: 20,596
- Created: 2026-03-15

## Fork Status
- Forked at: 2026-05-22 17:14:06 UTC
- Branches synced: `main` (upstream) + all feature branches (500+ remote branches)
- No local development branches (main only)

## Repository Structure

```
nemoclaw/
├── bin/                    # CJS CLI launchers (nemoclaw.js, nemohermes.js)
├── src/                    # TypeScript CLI source
│   ├── lib/                # Core CLI logic
│   │   ├── actions/        # Sandbox, credentials, inference actions
│   │   ├── adapters/       # OpenShell, Docker, Gateway adapters
│   │   ├── cli/            # CLI entry point, commands
│   │   ├── cluster-image-patch.ts
│   │   ├── credentials/    # Credential management
│   │   ├── dashboard/      # Dashboard URL handling
│   │   ├── domain/         # Domain models, lifecycle
│   │   ├── gateway-runtime-action.ts
│   │   ├── inference/      # Inference provider config
│   │   ├── onboard/        # Onboarding FSM, providers
│   │   ├── policies/       # Network policy management
│   │   └── state/          # State management, paths
│   └── commands/           # CLI commands (oclif)
├── nemoclaw/               # OpenClaw plugin (Commander CLI extension)
│   └── src/
│       ├── blueprint/      # Runner, snapshot, SSRF validation
│       ├── commands/       # Slash commands, migration state
│       └── onboard/        # Plugin onboarding
├── nemoclaw-blueprint/    # YAML blueprint definition
│   ├── policies/           # Network policy presets
│   ├── model-specific-setup/ # Agent-scoped compatibility
│   ├── router/             # Model router config
│   └── scripts/            # Blueprint scripts (TypeScript)
├── agents/                 # Agent definitions (Hermes, OpenClaw)
├── test/                   # Root-level integration tests (Vitest/ESM)
│   └── e2e/                # End-to-end tests, scenario runner
├── docs/                   # Fern MDX docs + legacy MyST
├── fern/                   # Fern site config
├── scripts/                # Bash/JS/TS automation
├── ci/                     # CI helper scripts
└── tools/                 # Development tools
```

## Package Info
- **Name**: `nemoclaw`
- **Version**: `0.1.0`
- **Node requirement**: `>=22.16.0`
- **Package manager**: npm
- **Key dependencies**: `@oclif/core@^4.10.5`, `js-yaml`, `yaml`, `p-retry`, `@aws-sdk/client-bedrock-runtime`
- **Dev dependencies**: Vitest, Biome, TypeScript, tsx, commitlint

## Build & Test
- **Build**: `npm run build:cli` → TypeScript compiles `src/` to `dist/`, generates oclif manifest
- **Tests**: Vitest (5 projects: cli, installer-integration, plugin, e2e-scenario-framework, e2e-branch-validation)
- **Linting**: Biome + prek hooks (pre-commit, commit-msg, pre-push)
- **Format**: Biome format, shfmt for shell scripts
- **CI**: GitHub Actions (PR, nightly-e2e, sandbox-images, etc.)

## CI/CD Workflows (`.github/workflows/`)
- `pr.yaml` — PR checks, basic-checks, Ollama proxy E2E
- `pr-self-hosted.yaml` — Sandbox image builds on NVIDIA runners
- `main.yaml` — Main branch CI
- `nightly-e2e.yaml` — Nightly E2E test suite
- `e2e-scenarios-all.yaml` — Scenario-based E2E
- `regression-e2e.yaml` — Regression E2E tests
- `brev-nightly-e2e.yaml` — Brev cloud E2E
- `platform-vitest-main.yaml` — Platform-specific Vitest
- `macos-e2e.yaml`, `wsl-e2e.yaml` — Platform E2E
- `base-image.yaml` — Base image builds
- `docs-preview-pr.yaml` — Docs preview for PRs
- `code-scanning.yaml` — CodeQL scanning
- `docker-pin-check.yaml` — Docker image pin validation

## Test Status
```
✓  CLI tests run (selected)
✓  Plugin compilation works
✓  TypeScript compiles cleanly
✓  Build artifact: dist/ + nemoclaw/dist/
```

## Code Quality
- **Linter**: Biome (v2.4.14) + prek hooks
- **Formatter**: Biome + shfmt for shell scripts
- **Type system**: TypeScript strict (multiple tsconfig files)
- **Commit format**: Conventional Commits (enforced via commitlint)
- **SPDX headers**: Required on all source files
- **Shell scripts**: ShellCheck enforced

## Open Issues Summary (473 open)
- **Bug reports**: WSL2/Docker issues, macOS sandbox, DGX Spark GPU
- **Security**: Permission issues (world-readable config), sandbox isolation
- **Policy/Network**: npm/pypi preset restrictions, proxy test behavior
- **Inference**: Ollama local setup, NIM container timeouts, model compatibility
- **Messaging**: Discord Telegram integration issues, channel enrollment
- **E2E**: Nightly test flakiness, OpenClaw version drift, Slack API changes

## Key Observations
1. Very active development (500+ branches, 30 open PRs as of 2026-05-22)
2. Multi-project TypeScript monorepo (root CLI + nemoclaw plugin + blueprint)
3. Strong CI/CD culture — comprehensive E2E, platform-specific tests
4. Messaging subsystem under active VRDC development (workflow planner, manifest compiler)
5. Dual-language stack: TypeScript + YAML blueprint + Bash/Python scripts
6. Agent skills system for user/maintainer/contributor audiences
7. Large feature branch count suggests parallel development streams
8. Active security focus (permissions, sandbox isolation, SSRF validation)
9. OpenShell dependency critical — many issues reference OpenShell version compatibility
10. Brev cloud E2E testing for cloud provisioning validation