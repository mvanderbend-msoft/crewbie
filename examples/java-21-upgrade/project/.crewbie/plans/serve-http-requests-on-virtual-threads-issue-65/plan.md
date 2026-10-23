# Planning issue #65

Four tasks. Persistence first removes the two things that make virtual threads unsafe here: driver code that pins carrier threads and the implicit connection limit the thread pool provided. The build platform then switches the executor and makes pinning visible in CI.

Implement the user-supplied requirements at https://github.com/contoso/ledger-service/issues/65. Source revision: 2026-10-13T09:00:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-65-29ee5521` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-ledger-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/ledger-service/issues/65

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
