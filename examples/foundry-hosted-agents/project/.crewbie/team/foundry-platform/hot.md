# foundry-platform: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- Grant the agent identity access in the concierge `postdeploy` hook, not at provision: the identity only exists after `azd deploy`, and `azd provision --preview` never shows the grant. <!-- source: #12 2026-08-29 -->
- `BOOKING_API_SCOPE` must end with `/.default`; the bare app ID URI fails token requests at runtime, not at deploy. <!-- source: #22 2026-09-10 -->
- Graph rejects a duplicate app role assignment, so `scripts/grant-agent-access.sh` checks with GET before POST; the second deploy failed without it. <!-- source: #22 2026-09-11 -->
- Every job that signs in to Azure needs `environment: production`; the federated credential subject is that environment, and a job without it fails with AADSTS70021. <!-- source: #34 2026-09-25 -->
- The evaluation gate runs the host with `uv run python main.py` on the runner; inside `docker run` DefaultAzureCredential cannot see the runner's `az login`. <!-- source: #35 2026-09-26 -->
- The gate's host runs as the deploy identity, which also needs Search Index Data Reader on the search service; without it every policy row declined. <!-- source: #35 2026-09-27 -->
