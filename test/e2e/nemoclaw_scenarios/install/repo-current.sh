#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Install from a checked-out repo (repo-current / repo-checkout profile).
#
# Split from the install dispatcher to keep scenario setup logic flat and to
# make the per-profile code discoverable by grep. Honors E2E_DRY_RUN.

_E2E_INST_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_E2E_INST_REPO_RUNTIME_LIB="$(cd "${_E2E_INST_REPO_DIR}/../../runtime/lib" && pwd)"
# shellcheck source=../../runtime/lib/env.sh
. "${_E2E_INST_REPO_RUNTIME_LIB}/env.sh"
# shellcheck source=helpers/install-path-refresh.sh
. "${_E2E_INST_REPO_DIR}/helpers/install-path-refresh.sh"

e2e_install_repo() {
  e2e_env_trace "install-repo"
  if e2e_env_is_dry_run; then
    echo "[dry-run] install-repo (skipped)"
    return 0
  fi
  local repo_root
  repo_root="$(cd "${_E2E_INST_REPO_DIR}/../../../.." && pwd)"
  (
    cd "${repo_root}" || exit
    npm ci --ignore-scripts
    mkdir -p .e2e
    set +e
    ./node_modules/.bin/tsc -p tsconfig.src.json >.e2e/build-cli.log 2>&1
    build_status=$?
    set -e
    if [ "${build_status}" -ne 0 ]; then
      cat .e2e/build-cli.log >&2
      echo "CLI TypeScript build failed with status ${build_status}" >&2
      exit "${build_status}"
    fi
    if find nemoclaw-blueprint/scripts -name '*.ts' -print -quit | grep -q .; then
      set +e
      ./node_modules/.bin/tsc -p nemoclaw-blueprint/tsconfig.json >.e2e/build-blueprint.log 2>&1
      build_status=$?
      set -e
      if [ "${build_status}" -ne 0 ]; then
        cat .e2e/build-blueprint.log >&2
        echo "Blueprint TypeScript build failed with status ${build_status}" >&2
        exit "${build_status}"
      fi
    fi
    bash scripts/npm-link-or-shim.sh
  )
  nemoclaw_refresh_install_env
}
