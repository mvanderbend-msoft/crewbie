---
applyTo: "ledger-persistence/src/main/resources/db/migration/**"
---
# Flyway migrations

- Never edit or rename a released migration; Flyway validates checksums and production would refuse to start.
- The Java upgrade needs no schema change. A migration in an upgrade PR is a mistake.
