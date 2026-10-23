---
applyTo: "src/Contoso.Outdoor.Data/**,src/Contoso.Outdoor.Data.Core/**"
---
# Data access

- The database schema is authoritative. EF Core maps it explicitly (table, column and key names, `HasPrecision(18, 2)` for money); do not add EF Core migrations before cutover.
- EF6 lazy-loads navigation properties; EF Core does not. Ported queries use `Include` or projections so results match.
- Do not add EF6 migrations either: the schema is frozen while both apps read it.
