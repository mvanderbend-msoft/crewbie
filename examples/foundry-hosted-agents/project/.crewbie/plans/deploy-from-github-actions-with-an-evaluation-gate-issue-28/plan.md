# Planning issue #28

Three tasks. Evaluation turns `evals/` into a runnable uv project whose runner exits non-zero below any threshold; the platform specialist adds a deploy workflow signing in with OIDC; then the platform specialist wires the gate so the deploy job only runs after the evaluation job passes against the built container.

Implement the user-supplied requirements at https://github.com/contoso/travel-concierge/issues/28. Source revision: 2026-09-21T13:05:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-28-6175d6bf` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-agent-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/travel-concierge/issues/28

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
