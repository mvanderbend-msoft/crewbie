# Planning issue #12

Five tasks in dependency order. The shared domain is multi-targeted first, the new host starts as a YARP proxy in front of the legacy app, EF Core maps the existing schema, the container and Azure infrastructure follow the host, and the catalog routes are ported last, when host and data are in place. Revised: the catalog and product pages are both actions of the legacy CatalogController, so one task ports them.

Implement the user-supplied requirements at https://github.com/contoso/outdoor-store/issues/12. Source revision: 2026-08-25T09:14:00Z. Task acceptance criteria below map that scope to specialist-owned work.

## Delivery

Each task PR merges into `crewbie/issue-12-51678845` once its checks pass. When every task merged, Crewbie opens one feature PR to the default branch that crewbie-migration-reviewer reviews; test the feature on that branch and merge it yourself.

Source: https://github.com/contoso/outdoor-store/issues/12

This PR only adds plan files; the team, agents and configuration are unchanged.

## Start work
Review the final plan and task batch, then merge this PR. **Merging by a human with write access approves publication and paid cloud execution of this exact batch.** No separate GitHub approval review or local approval command is required by Crewbie. Your repository's branch protection still applies. Application PR merges remain human-owned.
