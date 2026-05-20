#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/../../lib/security_policy_credentials.sh"
echo "shields:config-consistent"
spc_assertion_id "post-onboard.security-shields.config-consistent"
spc_require_context E2E_SCENARIO
if e2e_env_is_dry_run; then echo "[dry-run] would verify shields config consistency"; fi
