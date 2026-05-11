<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# NemoClaw E2E

End-to-end tests organized around **setup scenarios** rather than
one-off shell scripts. A scenario declares *how you got to a working
NemoClaw* (platform + install + runtime + onboarding); a scenario
resolves to an **expected state** contract; once that state validates,
one or more **suites** run functional assertions against it.

```text
setup scenario → expected state → suite sequence
```

The declarative sources of truth live in three files — read these
first, they are short and deliberately not redundant with prose:

- [`scenarios.yaml`](scenarios.yaml) — platforms, installs, runtimes,
  onboarding choices, and the concrete scenarios that combine them.
- [`expected-states.yaml`](expected-states.yaml) — reusable structural
  contracts (gateway health, sandbox status, inference routing, etc.).
- [`suites.yaml`](suites.yaml) — ordered validation steps, each with a
  `requires_state` predicate.

## How to run

```bash
bash test/e2e/run-scenario.sh <id> --plan-only       # resolve + print plan, no side effects
bash test/e2e/run-scenario.sh <id> --dry-run         # helpers short-circuit with trace
bash test/e2e/run-scenario.sh <id> --validate-only   # assume setup done; validate expected state
bash test/e2e/run-scenario.sh <id>                   # full live run
bash test/e2e/run-suites.sh <suite-id> [<suite-id>…]
bash test/e2e/coverage-report.sh                     # Markdown matrix of scenario × suite
```

Override the runtime context dir with `E2E_CONTEXT_DIR=<path>` (default
`.e2e/`, gitignored). The scenario runner and suites communicate only
through `$E2E_CONTEXT_DIR/context.env` — suites do not rediscover
setup state.

## Where things live

```text
test/e2e/
  scenarios.yaml / expected-states.yaml / suites.yaml   # declarative inputs
  run-scenario.sh / run-suites.sh / coverage-report.sh  # entry points
  resolver/        # TypeScript: load, plan, validate, coverage (invoked via tsx)
  lib/             # shared shell helpers: context, env, cleanup, sandbox-exec, logging
    setup/         # install + onboard dispatchers (one file per dimension value)
    assert/        # outcome assertions (inference, credentials, policy, messaging)
    fixtures/      # reusable stubs (fake-openai, fake-{telegram,discord,slack}, older-base-image)
  suites/          # functional suites grouped by concern (smoke, onboarding, inference, …)
  parity-map.yaml  # legacy test-*.sh → migrated-suite mapping (per-assertion)
  MIGRATION.md     # wave-by-wave migration tracker
```

The CI entry points are `.github/workflows/e2e-scenarios.yaml`
(manual dispatch) and `.github/workflows/e2e-parity-compare.yaml`
(runs new vs. legacy and reports divergence). Existing workflows
(`nightly-e2e.yaml`, `macos-e2e.yaml`, `wsl-e2e.yaml`, etc.) are
unchanged during the migration.

## Adding to the matrix

Add-a-scenario, add-a-state, and add-a-suite are short edits to the
three YAML files above, plus shell scripts under `lib/setup/`,
`lib/assert/`, or `suites/<category>/`. The schemas in
[`resolver/schema.ts`](resolver/schema.ts) describe the required
shape; `run-scenario.sh <id> --plan-only` validates your change
without running anything destructive.

New legacy-style `test-*.sh` scripts are blocked by
`scripts/e2e/lint-conventions.ts` — migrate into the matrix instead.
