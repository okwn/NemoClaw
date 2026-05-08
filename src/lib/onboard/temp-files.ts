// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Create a temp file inside a directory with a cryptographically random name.
 * Uses fs.mkdtempSync (OS-level mkdtemp) to avoid predictable filenames that
 * could be exploited via symlink attacks on shared /tmp.
 * Ref: https://github.com/NVIDIA/NemoClaw/issues/1093
 */
export function secureTempFile(prefix: string, ext = ""): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, `${prefix}${ext}`);
}

/**
 * Safely remove a mkdtemp-created directory. Guards against accidentally
 * deleting the system temp root if a caller passes os.tmpdir() itself.
 */
export function cleanupTempDir(filePath: string, expectedPrefix: string): void {
  const parentDir = path.dirname(filePath);
  if (parentDir !== os.tmpdir() && path.basename(parentDir).startsWith(`${expectedPrefix}-`)) {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
}
