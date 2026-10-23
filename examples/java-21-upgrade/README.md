# Java 21 upgrade: Maven multi-module service from Java 11

**Repository** (`contoso/ledger-service`): a double-entry ledger API built with Maven. It has three modules:

- `ledger-core`: the domain, using Lombok `@Value`.
- `ledger-persistence`: JDBC, Flyway 7, PostgreSQL and Testcontainers.
- `ledger-app`: the JDK `HttpServer` and a Dockerfile based on `eclipse-temurin:11-jre`.

CI uses JDK 11. The repository already has an `AGENTS.md` and a custom `.github/agents/build.agent.md`.

**Destination** (from Crewbie Compass): build and run on Java 21 (Temurin) with the same API, balances and rounding. The service keeps its current frameworks and Maven. Records and pattern matching are used only in code a task already changes, after the toolchain change merges. See [`repo/docs/destination.md`](repo/docs/destination.md).

## Team

| Role | Model | Why this split |
| --- | --- | --- |
| `build-platform` | gpt-5.3-codex | Adopted from the existing `build` agent. Owns the compiler, plugin and library versions that block Java 21 (Lombok, Mockito, JaCoCo, Surefire and Testcontainers), CI and the container image. |
| `ledger-domain` | claude-sonnet-5.5 | Owns `ledger-core`. Converting a Lombok `@Value` class to a record renames its accessors. |
| `persistence` | gpt-5.3-codex | Owns `ledger-persistence`. Migrations are immutable, and Flyway 10+ needs `flyway-database-postgresql`. |
| `ledger-reviewer` | gpt-6.1-sol | Blocks any change to balances, rounding or the API, and enforces one concern per PR. |

### Adopting an existing agent

The review chose `adopt` for `.github/agents/build.agent.md`. Crewbie installs it as `crewbie-build-platform.agent.md`. The original instructions and tools come first, followed by Crewbie's role sections and the managed handoff block. The original is moved to `repo/.crewbie/agent-archive/github/agents/build.agent.md`. Init deletes `.github/agents/build.agent.md`, so it is not under `repo/`.

## Guidance

- `AGENTS.md` is updated. It keeps the money and migration rules, replaces the JDK 11 pin and the Lombok rule, and adds the command for building on JDK 21 while 11 is still the default.
- Path-scoped instructions: `java` (`**/*.java`), `maven` (`**/pom.xml`) and `migrations`.
- `copilot-setup-steps.yml` installs Temurin 21 and 11. JDK 11 is the default, and `JAVA_HOME_21_X64` points to JDK 21 until the toolchain change merges.
- MCP server: Context7 for version-specific library documentation, also for the cloud agent.

## Issue to plan

[`issue.md`](issue.md) asks to run on Java 21. [`plan.json`](plan.json) starts with `toolchain` (build-platform). Three tasks then follow it:

- `container-image` (build-platform). It is a separate PR so that payments can schedule the runtime change.
- `persistence-on-21` (persistence).
- `domain-records` (ledger-domain).
