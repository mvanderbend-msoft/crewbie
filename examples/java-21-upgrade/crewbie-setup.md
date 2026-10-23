# Crewbie assessment

Brownfield Maven multi-module service on Java 11 with a short AGENTS.md and one custom build agent. The upgrade to Java 21 mostly changes the build (compiler, plugins, Lombok, Mockito, JaCoCo, CI and image), so the existing build agent is adopted as the build-platform specialist. Domain and persistence code get their own owners because they change for different reasons, and a reviewer guards rounding and API parity.

## Assumptions

Copilot chose these defaults where evidence or answers were missing. Correct any that are wrong in the guidance or roles before applying.

- The cloud agent environment installs JDK 11 (default) and JDK 21 side by side until the toolchain change merges; afterwards the setup workflow should switch to 21 only.

## Destination (docs/destination.md)

Charted in the setup interview. Installed only when the file does not exist yet.

```markdown
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
```

## Proposed crew

| Specialist | Action | Model | Responsibility |
| --- | --- | --- | --- |
| build-platform | Adopt .github/agents/build.agent.md | gpt-5.3-codex | Own the build and runtime toolchain: the root `pom.xml`, module poms, plugin and dependency versions, `.github/workflows/ci.yml`, and the `ledger-app` packaging and `ledger-app/Dockerfile`. |
| ledger-domain | New specialist | claude-sonnet-5.5 | Own `ledger-core`: postings, journals, balancing and rounding, including optional Java 21 language modernisation in code it changes. |
| persistence | New specialist | gpt-5.3-codex | Own `ledger-persistence`: the JDBC repository, Flyway migrations, the PostgreSQL driver and Testcontainers integration tests. |
| ledger-reviewer | New specialist | gpt-6.1-sol | Review each feature PR for unchanged balances, rounding and HTTP API behavior, reproducible builds and the one-concern-per-PR upgrade rule. |

Concurrency: 2 active sessions. This is not a limit on team size.
PR reviewer: crewbie-ledger-reviewer reviews each feature PR before you merge it into the default branch.

Model profile: **balanced**. Explicit model overrides remain authoritative.
Crewbie launch limits: **20 per batch / 3 per task**, including the first attempt and uncertain requests. No feature token ceiling (set `execution.maxTokensPerFeature` to add one). Not a monetary cap.

### build-platform

Original: `.github/agents/build.agent.md` -> `.github/agents/crewbie-build-platform.agent.md`.
Archive: `.crewbie/agent-archive/github/agents/build.agent.md` (backup provenance). The active charter contains the complete original instructions, with tool restrictions and persona preserved; only lines that just point to guidance Copilot loads automatically are left out.

**Working knowledge**
- The root `pom.xml` uses `maven.compiler.source`/`target` 11, Lombok 1.18.20, Mockito 3.12.4, JaCoCo 0.8.7 and Surefire 2.22.2; all of these block or break on Java 21.
- Mockito 5 uses the inline mock maker; on Java 21 add `-XX:+EnableDynamicAgentLoading` to Surefire's argLine to silence the dynamic agent warning (JEP 451).
- Testcontainers 1.16 predates current Docker API versions; move to 1.19 or later with the upgrade.
- `.github/workflows/ci.yml` pins JDK 11 through actions/setup-java; switch it to 21 in the toolchain change.

**Checks**
- `mvn -B -ntp verify` passes on JDK 21 for all modules.
- The `ledger-app/Dockerfile` image starts and answers on port 8080.

**Model proposal (standard):** Version bumps and build configuration are well-specified, tool-heavy work where a coding-tuned model is efficient.

**Boundaries**
- Toolchain changes contain no refactoring of application code.
- No Flyway or PostgreSQL driver major upgrade in the same PR as the JDK change.

### ledger-domain

**Working knowledge**
- `ledger-core/src/main/java/com/contoso/ledger/core/Posting.java` is a Lombok `@Value` class; `LedgerService.java` calls `getSide()` and `getAmount()`, which become `side()` and `amount()` as a record.
- Balancing sums debits minus credits and rejects any non-zero balance; `ledger-core/src/test/java/com/contoso/ledger/core/LedgerServiceTest.java` covers the unbalanced case.

**Checks**
- `mvn -B -ntp -pl ledger-core verify` passes and JaCoCo line coverage does not drop.

**Model proposal (standard):** Small domain module with strong tests; careful but not deep reasoning.

**Boundaries**
- Never change rounding, scale or balancing rules in an upgrade task.

### persistence

**Working knowledge**
- `ledger-persistence/src/main/resources/db/migration/V1__ledger.sql` stores amounts as `NUMERIC(19,2)`; the repository writes all postings of a journal in one transaction.
- Flyway 7 runs on Java 21. Flyway 10 and later need the separate `flyway-database-postgresql` artifact, so a later Flyway upgrade adds it in the same change.

**Checks**
- `ledger-persistence/src/test/java/com/contoso/ledger/persistence/JdbcLedgerRepositoryIT.java` passes against PostgreSQL in Testcontainers on JDK 21.

**Model proposal (standard):** JDBC and migration work is mechanical but needs tests run against a real database.

**Boundaries**
- Never edit a released migration.

### ledger-reviewer

**Working knowledge**
- Accessor renames from Lombok to records compile but can break reflection-based JSON or JDBC mapping; check every use by name.

**Checks**
- Tests were not weakened or deleted to make the upgrade pass.
- The PR changes only what its task names: toolchain, one library or touched-code modernisation.

**Model proposal (standard):** A different model family from the implementers gives an independent review at moderate cost.

**Boundaries**
- Block any PR that changes a balance, rounding mode or API response.

## Existing agent decisions

- **adopt `.github/agents/build.agent.md`**: Its build rules are exactly what the toolchain upgrade needs; keep them as the build-platform specialist.

## Proposed guidance edits

4 concrete edits. These are applied only when guidance changes are approved.

### AGENTS.md

Keep the money and migration rules, replace the JDK 11 pin and the Lombok rule, and add the dual-JDK command.

```markdown
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

```

### .github/instructions/java.instructions.md

When Java 21 features become allowed, loaded only for Java sources.

```markdown
---
applyTo: "**/*.java"
---
# Java code during the upgrade

- Until the root `pom.xml` sets `maven.compiler.release` to 21, write Java 11 only.
- After that, records, pattern matching for `instanceof` and `switch`, and text blocks are welcome in code a task already changes. Do not refactor untouched files to use them.
- Converting a Lombok `@Value` class to a record renames accessors (`getAmount()` becomes `amount()`); update every caller in the same change.

```

### .github/instructions/maven.instructions.md

Java 21 build traps, loaded only for poms.

```markdown
---
applyTo: "**/pom.xml"
---
# Maven build

- Compile with `<maven.compiler.release>`, not `source`/`target`; `release` also checks API use against the target JDK.
- Java 21 needs at least Lombok 1.18.30, Mockito 5 (Byte Buddy 1.14), JaCoCo 0.8.11 and Surefire 3; older versions fail on class file version 65.
- Upgrade one blocking library per commit so a failing test points to its cause.

```

### .github/instructions/migrations.instructions.md

Keep the upgrade from touching released migrations.

```markdown
---
applyTo: "ledger-persistence/src/main/resources/db/migration/**"
---
# Flyway migrations

- Never edit or rename a released migration; Flyway validates checksums and production would refuse to start.
- The Java upgrade needs no schema change. A migration in an upgrade PR is a mistake.

```

### .github/workflows/copilot-setup-steps.yml

Runs before each Copilot cloud agent session so agents start with dependencies installed. Created only when absent; applied with the guidance choice.

```yaml
name: Copilot setup steps
on:
  workflow_dispatch:
  push:
    paths: [.github/workflows/copilot-setup-steps.yml]
  pull_request:
    paths: [.github/workflows/copilot-setup-steps.yml]
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: |
            21
            11
          cache: maven
```

## Proposed MCP servers

Applied with the guidance choice. Crewbie creates the local file only when it does not exist; never store secret values in it.

- **context7** (local, also cloud agent): Version-specific documentation and migration notes for Lombok, Mockito, JaCoCo, Flyway, Testcontainers and the JDK.

### .vscode/mcp.json

```json
{
  "servers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp@4.4.2"
      ]
    }
  }
}
```

### Copilot cloud agent

Paste into contoso/ledger-service Settings > Copilot > MCP servers (GitHub and Playwright are already enabled there).

```json
{
  "mcpServers": {
    "context7": {
      "type": "local",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp@4.4.2"
      ],
      "tools": [
        "*"
      ]
    }
  }
}
```

## Hosted planning

Enabled with model `claude-opus-5.5`. The ready-for-planning label authorizes a potentially billable planning run. Execution after a human merges the planning PR: **enabled (the merge approves paid work on the exact plan)**.

## Assessment findings and recommendations

Recommendations are not automatically applied. Only the concrete guidance edits above are proposed writes.

### instructions - AGENTS.md

Accurate rules (money, migrations), but pins JDK 11 and prescribes Lombok `@Value`, which conflicts with records after the upgrade.

**Recommendation:** Update it for the transition and move Java- and Maven-specific rules into path-scoped files.

**Disposition:** edit

### instructions

No path-scoped guidance for Java sources, poms or migrations.

**Recommendation:** Add scoped instructions for each.

**Disposition:** edit

### agents - .github/agents/build.agent.md

Useful build rules (versions only in the root pom, Maven Central only) that match the upgrade's main work.

**Recommendation:** Adopt it as crewbie-build-platform, keeping its instructions and tools.

**Disposition:** retain

### mcp

No MCP servers. The upgrade depends on exact library versions and migration notes.

**Recommendation:** Add Context7 for version-specific library documentation (also for the cloud agent).

**Disposition:** edit

### constitution

The parity rules fit in AGENTS.md and the destination.

**Recommendation:** No constitution for now.

**Disposition:** retain

## Coverage

AI guidance (agent instructions, custom agents, constitution and MCP metadata, bounded to 256 KB of text) plus redacted build evidence: manifest summaries (scripts, dependencies, engines), non-Crewbie CI workflow text and root file names. Application source, READMEs and other project files are not read; only their names are mapped (directories and workspaces) to check cited paths. Ignored files and personal/global MCP settings are not read. MCP configurations are inspected, never launched; arguments, URLs, headers and credential values are withheld. Builds and server availability are unverified.


## Reviewed installation files

- Create .crewbie/config.json [User policy] - Team, explicit models, approvals and limits; update preserves your configuration.
- Create .crewbie/instructions.md [Crewbie-managed] - Single shared working policy referenced by specialists, not duplicated into each charter.
- Create .github/skills/crewbie/SKILL.md [Crewbie-managed] - Discover the local implementation workflow on demand instead of always loading it.
- Create .github/workflows/crewbie-plan.yml [Crewbie-managed] - Prepare a coordinator plan from approved issue intake; the planning opt-in gate still applies. Human-edited workflows block update.
- Create .github/workflows/crewbie-execute-plan.yml [Crewbie-managed] - Treat a write-access human's merge as execution approval after verifying the exact plan, source and policy before publishing implementation tasks. Human-edited workflows block update.
- Create .github/workflows/crewbie-dispatch.yml [Crewbie-managed] - Release approved tasks when dependencies, capacity and launch controls permit; merge each finished task PR into its plan's feature branch once checks pass, then open the feature PR to the default branch and request its review. Human-edited workflows block update.
- Create .github/workflows/crewbie-review.yml [Crewbie-managed] - Have the configured Crewbie reviewer comment on each task and feature PR head; reads the API diff and never runs PR code. Human-edited workflows block update.
- Create .github/workflows/crewbie-fix.yml [Crewbie-managed] - Run the named Crewbie operation with bounded permissions. Human-edited workflows block update.
- Create .github/workflows/crewbie-maintain.yml [Crewbie-managed] - Offer bounded knowledge-maintenance proposals; scheduled analysis remains opt-in. Human-edited workflows block update.
- Create .github/workflows/crewbie-report.yml [Crewbie-managed] - Collect execution evidence into a static report without starting implementation agents. Human-edited workflows block update.
- Create .crewbie/agent-archive/github/agents/build.agent.md [Preserved original] - Keep the adopted agent's original domain guidance and restrictions.
- Archive/remove .github/agents/build.agent.md [Archived original] - Remove the original only after preserving its approved charter in the agent archive.
- Create .vscode/mcp.json [Reviewed MCP configuration] - Proposed local MCP servers; secrets are prompted when a server starts and never written. Created only when absent.
- Create .github/workflows/copilot-setup-steps.yml [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create docs/destination.md [User knowledge] - Purpose, users, constraints, decisions, open questions and scope charted in the setup interview; agents read it for project context. Created when absent; replaced only when revisited in init.
- Update AGENTS.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/java.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/maven.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/migrations.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/agents/crewbie-build-platform.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/build-platform/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/build-platform/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-ledger-domain.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/ledger-domain/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/ledger-domain/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-persistence.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/persistence/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/persistence/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-ledger-reviewer.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/ledger-reviewer/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/ledger-reviewer/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-coordinator.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/coordinator/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/coordinator/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-improver.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/improver/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/improver/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .crewbie/decisions/hot.md [User guidance] - Keep approved principles or shared decisions; reuse existing documents.
- Create .crewbie/decisions/index.md [User guidance] - Seed shared-decision topic pointers; existing knowledge is never regenerated.
- Create .github/PULL_REQUEST_TEMPLATE.md [Crewbie-managed] - Prompt for concise implementation evidence, handoffs and learning.

## Installation choice

Team plus the concrete guidance edits listed above.
