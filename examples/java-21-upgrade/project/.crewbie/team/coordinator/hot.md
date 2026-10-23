# coordinator: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- `maxActive` is 2: when three tasks wait on one dependency, give the image task the highest priority, because payments needs two weeks with it. <!-- source: #33 2026-08-25 -->
- Humans want a library upgrade proven against production's existing state (the #46 revise added a Flyway 7 history test); plan that task up front for persistence libraries. <!-- source: #46 2026-09-07 -->
- `ledger-app` handlers have no owning role; give HTTP mapping to ledger-domain and keep the executor, packaging and image with build-platform. <!-- source: #56 2026-09-21 -->
