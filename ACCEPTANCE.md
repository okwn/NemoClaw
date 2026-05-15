# Definition of Done — E2E Regression Guard

Coverage guard #3595 adds `onboard-inference-smoke-e2e` in `.github/workflows/regression-e2e.yaml`.

The fix PR for #3253 is not complete until this job flips:

- RED on main-equivalent unfixed code: <https://github.com/NVIDIA/NemoClaw/actions/runs/25923084961>
- GREEN on the fix branch: pending

Dispatch command:

    gh workflow run regression-e2e.yaml --repo NVIDIA/NemoClaw -f jobs=onboard-inference-smoke-e2e --ref <fix-branch>

Expected failure on unfixed code:

    setupInference() accepted a configured route without proving the chat/completions path; onboard would later print Installation complete while the first real request returns HTTP 503 (#3253)
