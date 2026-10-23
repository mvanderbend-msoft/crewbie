# Parity tests

How `tests/Contoso.Outdoor.Data.Core.Tests` shows that EF Core 10 reads and writes the shared schema the way EF6 did. Written on #21 (2026-09-01), extended on #33 and #53.

## Why not run EF6 next to EF Core

`Contoso.Outdoor.Data` targets net48 and reads its connection string from `Web.config`. It cannot load in a .NET 10 test host, and a net48 test project could not reference `Contoso.Outdoor.Data.Core`. So the tests compare EF Core against two fixed artefacts instead:

- `Sql/schema.sql`: the tables, column types and keys as EF6 created them on CONTOSO-SQL01, scripted from the database (not from the EF6 model) plus three seed products.
- `Recorded/legacy-catalog.json`: what the legacy app returned for a category page and a priced cart against that seed.

## What runs

- `SqlServerFixture` starts SQL Server 2022 in Testcontainers once per test run and applies `schema.sql`. It needs Docker; on Windows runners the image pull is slow, which is why `copilot-setup-steps.yml` pulls it in advance.
- `CatalogParityTests.Every_mapped_column_matches_the_schema` reads `INFORMATION_SCHEMA.COLUMNS` and compares every mapped property's table, column name, type, precision and scale with the EF Core model. This is the test that caught the singular table names and `decimal(18,2)` on #21.
- `Category_page_matches_the_legacy_result` and `Cart_pricing_matches_the_legacy_total_and_skips_deleted_products` compare query results with the recorded JSON; the second also adds a product id that no longer exists (#33).
- `OrderWriterTests` writes an order and reads it back with plain SQL, so the `Order_Id` column and the `DeliveryAddress_*` columns are checked against the real names (#53).

## Refreshing the recordings

Only when the legacy behaviour changes on purpose:

1. Restore `schema.sql` and its seed into a local SQL Server and point the legacy app at it.
2. Request `/Catalog/Index?category=tents` and price a cart holding one camp stove, then save the JSON responses into `Recorded/legacy-catalog.json`.
3. State in the PR why the recording changed; the reviewer treats an unexplained change as a regression.

If the schema on CONTOSO-SQL01 changes, script it again with `sqlpackage /a:Extract` and replace `schema.sql`; do not edit it by hand.

## Not covered

- Lazy loading: EF6 loaded `Product.Category` lazily; EF Core does not. Queries project what pages need, so no test depends on it.
- Concurrency: neither model has a rowversion column, so there is nothing to compare yet.