# build-platform: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- Surefire and Failsafe `argLine` must start with `@{argLine}`: a plain value replaces JaCoCo's agent and coverage silently drops to 0% ([detail](cold/java-21-build-traps.md)). <!-- source: #35 2026-08-27 -->
- Mockito 5 self-attaches its inline mock maker; keep `-XX:+EnableDynamicAgentLoading` in the managed `argLine` or JDK 21 warns on every run and a later JDK refuses the agent. <!-- source: #35 2026-08-27 -->
- `mvn test` never runs `*IT` classes; only Failsafe in `verify` does, so a module without the failsafe plugin passes with its integration tests skipped. <!-- source: #39 2026-08-28 -->
- The jar manifest puts `lib/` on the classpath (`copy-dependencies`); the Dockerfile must copy `target/lib` too or the container fails with `NoClassDefFoundError`. <!-- source: #37 2026-08-28 -->
- Payments pins base images by digest in their deploy repository; a runtime image PR must give the `eclipse-temurin:21-jre` digest, not only the tag. <!-- source: #37 2026-08-28 -->
- Manage `flyway-database-postgresql` with `${flyway.version}`; a version mismatch with `flyway-core` builds fine and fails at start with "No database found to handle jdbc:postgresql". <!-- source: #54 2026-09-14 -->