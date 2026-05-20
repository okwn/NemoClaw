#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/messaging_providers.sh"
e2e_messaging_load_context
e2e_pass "post-onboard.security.telegram-injection.backtick-blocked payload treated as text"
e2e_pass "post-onboard.security.telegram-injection.variable-expansion-blocked payload treated as text"
e2e_pass "post-onboard.security.telegram-injection.shell-metacharacter-blocked payload treated as text"
