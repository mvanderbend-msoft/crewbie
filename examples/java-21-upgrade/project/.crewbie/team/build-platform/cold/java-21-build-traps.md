# Java 21 build traps

What the toolchain change (#35) ran into, in the order CI showed it. Versions are in the root `pom.xml`.

## Class file version 65

The first push moved `maven.compiler.release` to 21 and upgraded Lombok, Mockito and Surefire, but left JaCoCo at 0.8.7. Every module failed in `jacoco:prepare-agent` instrumentation with `Unsupported class file major version 65`. JaCoCo 0.8.11 is the first release that reads Java 21 classes; we use 0.8.12. Lombok below 1.18.30 fails differently: `java.lang.ExceptionInInitializerError` from `com.sun.tools.javac` during compilation, with no mention of Lombok in the first line.

## Coverage at 0%

The second push added `-XX:+EnableDynamicAgentLoading` to Surefire's `<argLine>` for Mockito's inline mock maker. The build went green, but the JaCoCo report showed 0% for `ledger-core`, which the agent caught by comparing the uploaded `coverage` artifact with the one from `main`. A literal `<argLine>` replaces the `argLine` property that `jacoco:prepare-agent` sets, so the JaCoCo agent never loaded. The fix is late property evaluation: `<argLine>@{argLine} -XX:+EnableDynamicAgentLoading</argLine>` plus an empty `<argLine/>` property in the root pom, so modules where JaCoCo is skipped still resolve `@{argLine}`. Failsafe needs the same configuration.

## Mockito and the inline mock maker

Mockito 5 made the inline mock maker the default. It attaches a Java agent at runtime; JDK 21 allows that with a warning (JEP 451) and a future JDK will refuse it. If the flag ever has to go, the alternative is passing Mockito as `-javaagent` from `maven-dependency-plugin:properties`.

## Integration tests that never ran

Surefire's default includes are `*Test`, `*Tests` and `*TestCase`. `JdbcLedgerRepositoryIT` existed before the upgrade but no module declared Failsafe, so it had never run in CI (#39). When it first ran it failed on the `side` column, a real bug. Check the Failsafe summary (`Tests run:` under `maven-failsafe-plugin`) in the CI log, not only the build result.