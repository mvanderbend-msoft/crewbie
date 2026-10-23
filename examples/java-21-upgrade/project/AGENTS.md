# Ledger service

Double-entry ledger API (Maven multi-module: `ledger-core`, `ledger-persistence`, `ledger-app`) on Java 21 (Temurin). Project context and open decisions: `docs/destination.md`.

## Commands

- Build and test: `mvn -B -ntp verify` (persistence integration tests need Docker for Testcontainers).
- One module: `mvn -B -ntp -pl ledger-core -am verify`.
- Integration tests are named `*IT` and run under Failsafe in `verify`; `mvn test` skips them.

## Rules

- Money is `BigDecimal` with scale 2 and `RoundingMode.HALF_EVEN`; never `double`. Compare amounts with `compareTo`, not `equals`.
- Flyway migrations are immutable once released; add a new `V<n>__` file instead.
- Plugin and dependency versions live only in the root `pom.xml`.
