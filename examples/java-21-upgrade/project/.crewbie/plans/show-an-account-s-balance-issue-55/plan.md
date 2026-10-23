# Planning issue #55

Three tasks. The domain adds the balance types and the query port first; persistence implements the port with one SQL aggregate, and the domain role, which maps domain results to HTTP responses, adds the endpoint in `ledger-app`. No migration.

Implement the user-supplied requirements at https://github.com/contoso/ledger-service/issues/55. Source revision: 2026-09-21T13:15:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-55-d8fdd1d9` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-ledger-reviewer reviews; test the feature on that branch and merge it yourself.

## Plan checks

Crewbie compared the tasks with the source issue and the repository file names. Advisory; nothing was changed.

- `balance-endpoint` states values the source issue does not: HTTP 200, HTTP 404. Confirm them, or ask instead of guessing.

Source: https://github.com/contoso/ledger-service/issues/55

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
