// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectRecommendedJobs,
  extractDispatchableJobs,
  planAutoDispatch,
} from "../tools/e2e-advisor/dispatch.mts";

const ROOT = path.resolve(import.meta.dirname, "..");

function pullRequest(authorAssociation = "MEMBER", overrides = {}) {
  return {
    pull_request: {
      number: 123,
      author_association: authorAssociation,
      ...overrides,
      head: {
        ref: "feature/e2e-advisor",
        sha: "abc123def456",
        repo: { full_name: "NVIDIA/NemoClaw" },
      },
      base: { ref: "main" },
    },
  };
}

function advisorResult(job = "network-policy-e2e") {
  return {
    confidence: "high",
    requiredTests: [
      {
        id: job,
        job,
        workflow: "nightly-e2e.yaml",
        reason: "covers the changed network policy path",
      },
    ],
  };
}

describe("E2E advisor auto-dispatch planning", () => {
  it("derives dispatchable jobs from nightly-e2e selective-dispatch predicates", () => {
    const workflowText = fs.readFileSync(
      path.join(ROOT, ".github/workflows/nightly-e2e.yaml"),
      "utf8",
    );
    const jobs = extractDispatchableJobs(workflowText);

    expect(jobs).toContain("network-policy-e2e");
    expect(jobs).toContain("cloud-e2e");
    expect(jobs).not.toContain("report-to-pr");
    expect(jobs).not.toContain("notify-on-failure");
    expect(jobs).not.toContain("scorecard");
  });

  it("plans a trusted main-workflow dispatch for NVIDIA org member PRs", () => {
    const workflowText = fs.readFileSync(
      path.join(ROOT, ".github/workflows/nightly-e2e.yaml"),
      "utf8",
    );
    const plan = planAutoDispatch({
      result: advisorResult(),
      workflowText,
      event: pullRequest("MEMBER"),
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "NVIDIA/NemoClaw",
      },
    });

    expect(plan.status).toBe("ready");
    expect(plan.ref).toBe("main");
    expect(plan.inputs).toMatchObject({
      jobs: "network-policy-e2e",
      target_ref: "abc123def456",
      pr_number: "123",
    });
  });

  it("skips PRs that are not authored by org members or owners", () => {
    const workflowText = fs.readFileSync(
      path.join(ROOT, ".github/workflows/nightly-e2e.yaml"),
      "utf8",
    );
    const plan = planAutoDispatch({
      result: advisorResult(),
      workflowText,
      event: pullRequest("COLLABORATOR"),
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "NVIDIA/NemoClaw",
      },
    });

    expect(plan.status).toBe("skipped");
    expect(plan.reason).toMatch(/not allowed/);
  });

  it("skips draft PRs", () => {
    const workflowText = fs.readFileSync(
      path.join(ROOT, ".github/workflows/nightly-e2e.yaml"),
      "utf8",
    );
    const plan = planAutoDispatch({
      result: advisorResult(),
      workflowText,
      event: pullRequest("MEMBER", { draft: true }),
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "NVIDIA/NemoClaw",
      },
    });

    expect(plan.status).toBe("skipped");
    expect(plan.reason).toBe("PR is a draft");
  });

  it("ignores recommendations that are not dispatchable in the target workflow", () => {
    const workflowText = fs.readFileSync(
      path.join(ROOT, ".github/workflows/nightly-e2e.yaml"),
      "utf8",
    );
    const plan = planAutoDispatch({
      result: advisorResult("not-a-real-e2e-job"),
      workflowText,
      event: pullRequest("OWNER"),
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "NVIDIA/NemoClaw",
      },
    });

    expect(plan.status).toBe("skipped");
    expect(plan.ignoredJobs).toEqual(["not-a-real-e2e-job"]);
  });

  it("collects only recommendations for the target workflow", () => {
    expect(
      collectRecommendedJobs({
        requiredTests: [
          { id: "network-policy-e2e", workflow: "nightly-e2e.yaml" },
          { id: "wsl-e2e", workflow: "wsl-e2e.yaml" },
        ],
      }),
    ).toEqual(["network-policy-e2e"]);
  });
});
