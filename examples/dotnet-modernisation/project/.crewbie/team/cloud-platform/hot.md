# cloud-platform: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- The container app uses a user-assigned identity whose AcrPull and Key Vault roles exist before the app; with a system-assigned identity the first revision cannot pull its image. <!-- source: #22 2026-09-03 -->
- Set `AZURE_CLIENT_ID` on the container: with a user-assigned identity, `Authentication=Active Directory Default` otherwise finds no identity and SQL sign-in fails. <!-- source: #22 2026-09-03 -->
- The OIDC federated credential subject is `repo:contoso/outdoor-store:environment:production` because the deploy job uses a GitHub environment; a branch subject is rejected. <!-- source: #22 2026-09-03 -->
- In multiple-revision mode, traffic that follows the latest revision moves to a new revision at once; `deploy.yml` pins traffic to the serving revision by name before `azd deploy`. <!-- source: #44 2026-10-06 -->
- Forwarded requests also land in `AppRequests`, named after the YARP catch-all route; filter on ported action names or a legacy outage pages the team for the new host. <!-- source: #55 2026-10-17 -->
