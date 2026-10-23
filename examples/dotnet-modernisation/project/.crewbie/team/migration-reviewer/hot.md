# migration-reviewer: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- On any host change, check HTTPS redirection behind ingress: tests call the host directly, so a 307 instead of legacy's 302 or missing forwarded headers only show up in Azure. <!-- source: #24 2026-09-06 -->
- Compare error paths, not just happy paths: legacy `HandleErrorAttribute` turns exceptions into 500 pages, so a port that returns 404 changes behavior and needs a recorded decision in `docs/destination.md`. <!-- source: #24 2026-09-06 -->
- Compare attributes action by action: a missing `[ValidateAntiForgeryToken]` passes every happy-path test, because those tests fetch a valid token first. <!-- source: #35 2026-09-22 -->
- Readiness must not depend on the legacy app; an IIS outage would then take the replicas serving ported routes out of rotation too. <!-- source: #45 2026-10-07 -->
