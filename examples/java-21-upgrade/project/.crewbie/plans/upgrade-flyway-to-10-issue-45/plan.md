# Planning issue #45

Three tasks. The build platform moves Flyway to 10 and adds the PostgreSQL database module that Flyway 10 needs, in one change so the build never runs without it. Persistence then adapts the migrator and its tests to the Flyway 10 API and defaults, and proves that a schema history written by Flyway 7 still validates.

Implement the user-supplied requirements at https://github.com/contoso/ledger-service/issues/45. Source revision: 2026-09-07T08:30:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-45-2d47096d` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-ledger-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/ledger-service/issues/45

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
