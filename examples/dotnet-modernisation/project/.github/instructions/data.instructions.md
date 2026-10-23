---
applyTo: "src/Contoso.Outdoor.Data/**,src/Contoso.Outdoor.Data.Core/**"
---
# Data access

- The database schema is authoritative. EF Core maps it explicitly (table, column and key names, and the column's real precision: money is `decimal(19,4)`, see `tests/Contoso.Outdoor.Data.Core.Tests/Sql/schema.sql`); do not add EF Core migrations before cutover.
- EF6 lazy-loads navigation properties; EF Core does not. Ported queries use `Include` or projections so results match.
- Do not add EF6 migrations either: the schema is frozen while both apps read it.
