# Planning issue #17

Three tasks. The platform specialist gives the agent identity access to the booking API through API Management and adds its settings; the agent runtime adds an approval-required `book_trip` tool and a booking client, tested through the approval round trip; evaluation adds tool-call accuracy cases once the tool exists. Changing and cancelling trips stay out, as the issue asks.

Implement the user-supplied requirements at https://github.com/contoso/travel-concierge/issues/17. Source revision: 2026-09-08T10:20:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-17-2bf50b5e` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-agent-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/travel-concierge/issues/17

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
