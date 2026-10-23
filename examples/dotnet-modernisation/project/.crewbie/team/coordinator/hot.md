# coordinator: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- The legacy app has no ProductController: `/p/{slug}` is `CatalogController.Product`. Plan route ports from `App_Start/RouteConfig.cs` and the controllers, not from URL names. <!-- source: #13 2026-08-26 -->
- Container Apps has no deployment slots; plan staged rollouts as a labelled revision of the existing app, not a second app. <!-- source: #38 2026-09-29 -->
