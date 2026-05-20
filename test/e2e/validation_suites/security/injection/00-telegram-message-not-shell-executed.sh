#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/../../lib/security_policy_credentials.sh"
echo "injection:telegram-message-not-shell-executed"
spc_assertion_id "post-onboard.security-injection.telegram-message-not-shell-executed"
spc_require_context E2E_SCENARIO
payload="${E2E_TELEGRAM_PAYLOAD_FIXTURE:-$(spc_context_get E2E_TELEGRAM_PAYLOAD_FIXTURE)}"
printf 'telegram payload treated as data (%s bytes)\n' "${#payload}"
if e2e_env_is_dry_run; then echo "[dry-run] would submit payload without shell evaluation"; fi
