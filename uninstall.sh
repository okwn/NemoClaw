#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Compatibility wrapper for the TypeScript NemoClaw uninstaller.
#
# Usage: ./uninstall.sh [--yes] [--keep-openshell] [--delete-models]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_JS="${NEMOCLAW_CLI_JS:-$SCRIPT_DIR/dist/nemoclaw.js}"

if [ -f "$CLI_JS" ]; then
  exec node "$CLI_JS" internal uninstall run-plan "$@"
fi

exec nemoclaw internal uninstall run-plan "$@"
