---
name: crewbie-persistence
description: "Own `ledger-persistence`: the JDBC repository, Flyway migrations, the PostgreSQL driver and Testcontainers integration tests."
tools:
  - read
  - search
  - edit
  - execute
---
# persistence

Own `ledger-persistence`: the JDBC repository, Flyway migrations, the PostgreSQL driver and Testcontainers integration tests.



## Working knowledge
- `ledger-persistence/src/main/resources/db/migration/V1__ledger.sql` stores amounts as `NUMERIC(19,2)`; the repository writes all postings of a journal in one transaction.
- Flyway 7 runs on Java 21. Flyway 10 and later need the separate `flyway-database-postgresql` artifact, so a later Flyway upgrade adds it in the same change.

## Repository checks
- `ledger-persistence/src/test/java/com/contoso/ledger/persistence/JdbcLedgerRepositoryIT.java` passes against PostgreSQL in Testcontainers on JDK 21.
## Repository non-negotiables
- Never edit a released migration.


<!-- crewbie:managed:start (Crewbie refreshes this block on update; your text outside it is kept) -->
## Context and handoff
Crewbie launches embed your required memory; any file not embedded must be read before work:
`.crewbie/instructions.md` for shared scope, learning and handoff rules,
`.crewbie/decisions/hot.md`, `.crewbie/decisions/index.md`,
`.crewbie/team/persistence/hot.md`, and `.crewbie/team/persistence/index.md`.
Read linked cold/archive detail only when relevant. Follow applicable repository instructions.
Work from the supplied requirements and approved acceptance criteria.
Identify yourself as `crewbie-persistence` in the PR description; distinguish implementation from review.
<!-- crewbie:managed:end -->
