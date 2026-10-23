# Ledger service

Double-entry ledger API (Maven multi-module: `ledger-core`, `ledger-persistence`, `ledger-app`) moving from Java 11 to Java 21. Project context and open decisions: `docs/destination.md`.

## Commands

- Build and test: `mvn -B -ntp verify` (persistence integration tests need Docker for Testcontainers).
- One module: `mvn -B -ntp -pl ledger-core -am verify`.
- Check on Java 21 while the default JDK is still 11: `JAVA_HOME=$JAVA_HOME_21_X64 mvn -B -ntp verify` (the setup workflow installs both).

## Rules

- Money is `BigDecimal` with scale 2 and `RoundingMode.HALF_EVEN`; never `double`.
- Flyway migrations are immutable once released; add a new `V<n>__` file instead.
- Plugin and dependency versions live only in the root `pom.xml`.
