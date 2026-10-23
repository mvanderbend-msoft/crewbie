# ledger-domain: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- `ledger-app` `JsonWriter` reads records by component and other classes by `get*` methods; before #43 a converted record was written as `{}`, so assert the JSON whenever a class changes shape. <!-- source: #43 2026-08-31 -->
- `BigDecimal.equals` compares scale (`10.0` is not `10.00`); compare amounts with `compareTo` or assert `toPlainString()`. <!-- source: #41 2026-08-29 -->
- `Journal` stays a Lombok `@Value` class until a task has to change it; converting it renames `getPostings()`, which persistence and `JsonWriter` both use. <!-- source: #42 2026-08-29 -->
- Switch over `BalanceResult` without a `default` branch, so a new result breaks the build in every handler instead of falling through silently. <!-- source: #58 2026-09-23 -->
- `HttpServer.createContext("/accounts")` matches by prefix, so `/accountsX` and `/accounts/a/balance/x` reach the handler; check the full path and answer 404. <!-- source: #62 2026-09-25 -->
- `getRequestURI().getPath()` decodes `%2F` to `/`, which splits account names; match on `getRawPath()` and decode the account segment yourself. <!-- source: #62 2026-09-25 -->
