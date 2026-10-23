# persistence: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- `posting.side` is `CHAR(1)` holding `D` or `C` (`Side.code()`), not the enum name; writing `side().name()` fails with "value too long for type character(1)". <!-- source: #39 2026-08-28 -->
- Since Flyway 9 `cleanDisabled` defaults to true; tests enable clean through `FlywayMigrator.configure(...).cleanDisabled(false)`, never inside `FlywayMigrator` itself. <!-- source: #50 2026-09-10 -->
- `fixtures/flyway7-history.sql` holds the checksum Flyway 7 recorded for `V1__ledger.sql`; even a whitespace edit to V1 makes `FlywayHistoryCompatIT` (and production start) fail validation. <!-- source: #52 2026-09-10 -->
- `SUM` over no matching rows returns one row holding NULL; `sumFor` maps NULL to empty (unknown account), so never wrap it in `COALESCE(..., 0)`. <!-- source: #60 2026-09-24 -->
- The balance query scans `posting` because `account` has no index; adding one is a schema change the destination still excludes, so raise it instead of adding a migration. <!-- source: #60 2026-09-24 -->
- Keep the PostgreSQL driver at 42.6 or later: older releases guard socket I/O with `synchronized`, which pins a virtual thread to its carrier for the whole query. <!-- source: #68 2026-10-15 -->
- `BoundedDataSource` must release the permit when `getConnection()` throws and only once per connection; a leaked permit shrinks the cap until the service stalls, with no error. <!-- source: #70 2026-10-16 -->
