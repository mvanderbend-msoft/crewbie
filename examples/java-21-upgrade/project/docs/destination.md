# Destination

Contoso's ledger service: the double-entry ledger API the payments and invoicing teams call, upgraded from Java 11 to Java 21 (LTS) without changing its API, its numbers or its frameworks.

## Notes

- Upgrade in small, reversible steps: build toolchain first, then libraries that block Java 21, then optional language modernisation in code that is touched anyway.
- Balances, rounding and the HTTP API must be identical before and after; the existing tests are the contract.
- The payments team deploys the container; they need two weeks' notice of the runtime image change.
- Java 21 shipped to production on 2026-09-15 (#42). New features follow the same rules: no API, balance or rounding change to what exists.

## Decisions so far

- **Target**: Java 21 (Eclipse Temurin) for build and runtime.
- **Frameworks**: No framework change: plain Java with the JDK HttpServer, JDBC and Flyway.
- **Build**: Maven stays; compile with `maven.compiler.release` 21.
- **Language features**: Records, pattern matching and switch expressions only in code a task touches anyway.
- **Virtual threads**: The HTTP server moves to virtual threads (#65), with open database connections capped at today's 32.
- **Container**: eclipse-temurin:21-jre base image.

## Not yet specified

- Whether an index on `posting.account` is allowed for balance queries; it would be the first schema change since V1.

## Out of scope

- Moving to Spring Boot, Quarkus or another framework.
- Migrating the build to Gradle.
- Database schema changes, until the index question above is decided.

<!-- Charted by crewbie init (Crewbie Compass interview). Keep it current: agents read it for project context and init reuses it. -->
