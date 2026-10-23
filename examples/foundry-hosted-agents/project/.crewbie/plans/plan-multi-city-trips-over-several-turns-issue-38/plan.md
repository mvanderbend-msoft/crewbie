# Planning issue #38

Four tasks. The agent runtime first restructures the concierge into a workflow with stable policy and booking steps served by a factory, then adds a read-only offer search tool per leg; evaluation adds multi-turn golden conversations once the workflow exists, and adds tracing for the workflow steps once the offer tool exists.

Implement the user-supplied requirements at https://github.com/contoso/travel-concierge/issues/38. Source revision: 2026-10-12T08:45:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-38-7bcaf377` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-agent-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/travel-concierge/issues/38

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
