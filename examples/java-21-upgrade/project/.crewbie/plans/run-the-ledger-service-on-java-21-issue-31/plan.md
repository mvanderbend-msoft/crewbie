# Planning issue #31

Four tasks. The build platform first moves the compiler, plugins and libraries that block Java 21 and switches CI; the container image follows separately so payments can schedule it. Persistence and domain then verify and modernise their modules on Java 21, each in its own PR.

Implement the user-supplied requirements at https://github.com/contoso/ledger-service/issues/31. Source revision: 2026-08-25T07:40:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-31-abfdb862` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-ledger-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/ledger-service/issues/31

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
