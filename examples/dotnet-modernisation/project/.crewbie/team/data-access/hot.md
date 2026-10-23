# data-access: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- EF6 created pluralised tables (`Products`, `Orders`, `OrderLines`); map each entity with `ToTable`, because EF Core names tables after the DbSet property or, without one, the class. <!-- source: #21 2026-09-01 -->
- Money columns are `decimal(19,4)` in the real schema, not EF's `(18,2)`; the column-type test in `CatalogParityTests` fails on a wrong `HasPrecision`, and rounding belongs only in PriceCalculator. <!-- source: #21 2026-09-01 -->
- Do not reference the EF6 project from .NET 10 tests: its model and config are net48-only. Parity tests use `Sql/schema.sql` and recorded legacy results, see [parity tests](cold/parity-tests.md). <!-- source: #21 2026-09-01 -->
- `OrderLines` uses EF6's independent-association column `Order_Id`, not `OrderId`; map the key with `HasForeignKey("Order_Id")` or EF Core queries a column that does not exist. <!-- source: #53 2026-10-16 -->
- With `EnableRetryOnFailure`, a `BeginTransaction` outside an execution strategy throws; one `SaveChanges` already writes an order and its lines atomically. <!-- source: #53 2026-10-16 -->
