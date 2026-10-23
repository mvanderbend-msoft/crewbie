# Planning issue #37

Three tasks. The host gets health endpoints and OpenTelemetry while the platform adds monitoring resources and probes; the rollout workflow follows both. Revised: Container Apps has no deployment slots, so staging is a labelled revision of the existing container app instead of a second app.

Implement the user-supplied requirements at https://github.com/contoso/outdoor-store/issues/37. Source revision: 2026-09-28T10:05:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-37-7d86327d` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-migration-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/outdoor-store/issues/37

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
