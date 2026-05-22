# 01_REPO_MAP.md — NemoClaw

## Repository Hierarchy

```
github.com/NVIDIA/NemoClaw  (upstream, org: NVIDIA)
    └── fork: github.com/okwn/NemoClaw  (user fork)
```

## Branches

### Upstream (`NVIDIA/NemoClaw`)
| Branch | Description |
|--------|-------------|
| `main` | Primary development branch |
| `release/v0.0.7`, `release/v0.0.7.1` | Release branches |
| `docs-*` | Documentation updates |
| `ci-*` | CI/CD improvements |
| `refactor/*` | Large-scale refactoring (100+ branches) |
| `test/*` | Test coverage improvements |
| `fix/*` | Bug fixes |
| `feat/*` | Feature development |
| `worktree-*` | Worktree management |
| `upgrade/*` | Dependency upgrades |
| `u/*` | User branches |
| `revert/*` | Revert branches |
| `automation/*` | Automated sync branches |
| `codex/*` | Codex-assisted branches |
| `autoresearch/*` | Auto research branches |

### Local (`okwn/NemoClaw`)
| Branch | Description |
|--------|-------------|
| `main` | Synced with upstream main |

## Package Structure

### Root Package (`nemoclaw`)
```
nemoclaw (npm package)
├── bin/
│   ├── nemoclaw.js          # CLI launcher entry point (CJS)
│   └── nemohermes.js        # Hermes alias launcher (CJS)
├── dist/                    # Compiled CLI output
├── src/lib/                 # TypeScript source → compiled to dist/
├── src/commands/            # oclif command tree → dist/commands/
└── package.json             # npm package manifest
```

### Plugin Package (`nemoclaw/`)
```
nemoclaw (oclif plugin)
├── dist/                    # Compiled plugin output
├── src/
│   ├── blueprint/           # Runner, snapshot, SSRF, state
│   ├── commands/            # Slash commands, migration
│   └── onboard/             # Onboarding config
├── openclaw.plugin.json     # Plugin manifest
└── package.json             # Separate npm project
```

### Blueprint Package (`nemoclaw-blueprint/`)
```
nemoclaw-blueprint (YAML config + TS scripts)
├── blueprint.yaml           # Main blueprint definition
├── policies/                 # Network policy presets
│   └── presets/             # slack.yaml, discord.yaml, etc.
├── model-specific-setup/    # Per-agent compatibility manifests
├── router/                  # Model router config
│   └── pool-config.yaml     # Model pool definition
├── scripts/                 # TypeScript helpers
└── tsconfig.json
```

## Source Code Structure

```
src/
├── lib/
│   ├── actions/             # Domain actions
│   │   ├── dev/             # npm link/shim actions
│   │   ├── sandbox/         # Sandbox lifecycle (create/destroy/rebuild)
│   │   └── skill-install.ts
│   ├── adapters/            # External system adapters
│   │   ├── openshell-adapter.ts
│   │   ├── docker-adapter.ts
│   │   └── gateway-adapter.ts
│   ├── cli/
│   │   └── index.ts         # CLI entry point
│   ├── cluster-image-patch.ts
│   ├── credentials/         # Credential registry & sanitization
│   │   ├── registry.ts
│   │   └── sanitize.ts
│   ├── dashboard/           # Dashboard URL handling
│   ├── deploy/              # Deployment actions
│   ├── diagnostics/         # Diagnostic tools
│   ├── domain/              # Domain models
│   │   └── lifecycle/       # Lifecycle state machines
│   ├── inference/           # Inference provider config
│   │   ├── config.ts
│   │   ├── local.ts         # Ollama, vLLM
│   │   └── nim.ts           # NVIDIA NIM
│   ├── onboard/             # Onboarding FSM
│   │   ├── index.ts         # Main onboarding orchestrator
│   │   ├── machine/         # State machine transitions
│   │   ├── providers.ts    # Provider selection
│   │   └── docker-driver-gateway-env.ts
│   ├── policies/            # Network policy management
│   ├── state/               # State persistence
│   │   └── paths.ts        # Path resolution
│   ├── messaging/          # Messaging channel integration
│   └── hermes-provider-auth.ts
│
└── commands/                # oclif command tree
    ├── onboard.ts
    ├── connect.ts
    ├── status.ts
    ├── logs.ts
    ├── rebuild.ts
    ├── destroy.ts
    ├── list.ts
    ├── inference/
    │   ├── get.ts
    │   └── set.ts
    ├── policy/
    ├── channels/
    ├── debug.ts
    └── internal/
        ├── installer/
        │   └── plan.ts
        └── ...

nemoclaw/src/
├── blueprint/
│   ├── runner.ts            # Sandbox runner
│   ├── snapshot.ts          # Snapshot create/restore
│   ├── ssrf.ts              # SSRF validation
│   └── state.ts            # Blueprint state
├── commands/
│   ├── index.ts            # Slash command registry
│   └── migrate.ts          # Migration handling
├── onboard/
│   └── config.ts           # Onboarding configuration
└── package-metadata.ts

nemoclaw-blueprint/
├── blueprint.yaml          # Root blueprint YAML
├── private-networks.yaml   # Private network config
├── policies/               # Policy definitions
│   ├── allowlisting/       # Allowlist rules
│   ├── presets/            # Preset policies
│   └── denylisting/        # Denylist rules
├── model-specific-setup/   # Per-model configuration
│   ├── openclaw/           # OpenClaw agent setup
│   └── hermes/             # Hermes agent setup
├── router/                 # LLM router config
├── scripts/                # Blueprint TypeScript helpers
└── openclaw-plugins/       # OpenClaw plugin wrappers
```

## Test Structure

```
test/                       # Root-level ESM tests (Vitest)
├── cli.test.ts
├── cli-oclif-compatibility.test.ts
├── install-preflight.test.ts         # Slow, opt-in
├── install-openshell-version-check.test.ts  # Slow, opt-in
├── seed-wechat-accounts.test.ts
├── generate-openclaw-config.test.ts
├── sandbox-build-context.test.ts
├── openclaw-tool-catalog-patch.test.ts
├── openclaw-tui-chat-correlation.test.ts
├── fetch-guard-patch-regression.test.ts
├── preinstall-node-version.test.ts
└── e2e/
    ├── test-cloud-inference-e2e.sh
    ├── test-skill-agent-e2e.sh
    ├── test-cloud-onboard-e2e.sh
    ├── test-docs-validation.sh
    ├── test-rebuild-openclaw.sh
    ├── test-openclaw-slack-pairing.sh
    ├── brev-e2e.test.ts     # Cloud E2E (opt-in)
    ├── scenario-framework-tests/
    │   └── e2e-lib-helpers.test.ts
    └── lib/
        └── slack-api-proof.sh

nemoclaw/src/               # Plugin unit tests (TypeScript, co-located)
├── package-metadata.test.ts
└── [co-located with source as *.test.ts]

vitest.config.ts           # Root Vitest config (5 projects)
nemoclaw/vitest.config.ts   # Plugin Vitest config
```

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Root package manifest (nemoclaw CLI) |
| `nemoclaw/package.json` | Plugin package manifest |
| `nemoclaw-blueprint/blueprint.yaml` | Blueprint definition |
| `vitest.config.ts` | Root Vitest configuration |
| `biome.json` | Biome linter/formatter config (shared) |
| `AGENTS.md` | Agent instructions and architecture docs |
| `CONTRIBUTING.md` | Contributing guidelines |
| `Makefile` | Make targets (check, lint, format, docs) |
| `install.sh` | Installer script |
| `uninstall.sh` | Uninstaller script |
| `Dockerfile` | Container build definition |
| `tsconfig.src.json` | CLI TypeScript config |
| `tsconfig.cli.json` | CLI type-check config |
| `jsconfig.json` | JS project references |
| `.github/workflows/*.yaml` | GitHub Actions workflows |
| `fern/fern.config.json` | Fern docs config |
| `pyproject.toml` | Python project config (uv) |

## Agent Skills

```
.agents/skills/
├── nemoclaw-user-*         # End user skills
├── nemoclaw-maintainer-*   # Project maintainer skills
└── nemoclaw-contributor-*  # Codebase contributor skills
```

Load via `nemoclaw-skills-guide` skill for full catalog.

## Network Policy Presets

```
nemoclaw-blueprint/policies/presets/
├── slack.yaml
├── discord.yaml
├── brave.yaml
├── pypi.yaml
├── npm.yaml
└── [more platform-specific presets]
```

## Credentials System

- Registry at `~/.nemoclaw/credentials/` (or equivalent state dir)
- Sanitization layer prevents credential leakage to sandbox
- Provider credentials: NVIDIA NIM, Ollama, OpenAI, Anthropic, Bedrock, etc.

## Inference Providers

- `nvidia` — NVIDIA NIM endpoints
- `openai` — OpenAI compatible
- `anthropic` — Anthropic
- `bedrock` — AWS Bedrock
- `ollama` — Local Ollama
- `ollama-local` — Local Ollama with full features
- `vllm` — vLLM local
- `routed` — Model router (experimental, NVIDIA LLM Router v3)

## Platform Support Matrix

| OS | Runtime | Status |
|----|---------|--------|
| Linux | Docker | Primary |
| macOS (Apple Silicon) | Colima, Docker Desktop | Tested (limitations) |
| DGX Spark | Docker | Tested |
| Windows WSL2 | Docker Desktop (WSL backend) | Tested (limitations) |