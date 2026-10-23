# Destination

Contoso's ledger service: the double-entry ledger API the payments and invoicing teams call, upgraded from Java 11 to Java 21 (LTS) without changing its API, its numbers or its frameworks.

## Notes

- Upgrade in small, reversible steps: build toolchain first, then libraries that block Java 21, then optional language modernisation in code that is touched anyway.
- Balances, rounding and the HTTP API must be identical before and after; the existing tests are the contract.
- The payments team deploys the container; they need two weeks' notice of the runtime image change.

## Decisions so far

- **Target**: Java 21 (Eclipse Temurin) for build and runtime.
- **Frameworks**: No framework change: plain Java with the JDK HttpServer, JDBC and Flyway.
- **Build**: Maven stays; compile with `maven.compiler.release` 21.
- **Language features**: Records, pattern matching and switch expressions only after the toolchain change merges, and only in code a task touches anyway (recommended default).
- **Virtual threads**: Not in this upgrade (assumed).
- **Container**: eclipse-temurin:21-jre base image.

## Not yet specified

- Whether the HTTP server moves to virtual threads later.

## Out of scope

- Moving to Spring Boot, Quarkus or another framework.
- Migrating the build to Gradle.
- Database schema changes.

<!-- Charted by crewbie init (Crewbie Compass interview). Keep it current: agents read it for project context and init reuses it. -->
