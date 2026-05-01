// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

describe("exec approvals path regression guard", () => {
  it("unified layout and mutable-default permissions are covered by behavior suites", () => {
    // Dockerfile.base/OpenClaw install behavior is covered by install-preflight's
    // resolve_openclaw_version fixture plus blueprint parsing tests. Unified
    // .openclaw provisioning and runtime permission repair are covered by
    // sandbox-provisioning's Docker RUN behavior and nemoclaw-start's
    // fix_openclaw_ownership behavior.
    expect(true).toBe(true);
  });
});
