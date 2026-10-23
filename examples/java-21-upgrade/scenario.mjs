// Scenario: a Maven multi-module ledger service upgrading from Java 11 to Java 21 without changing frameworks.
// `files` is the repository before init, `destination` the Crewbie Compass map, and `review` the JSON Copilot returned.
const module = (artifact, dependencies) => `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>com.contoso.ledger</groupId>
    <artifactId>ledger-parent</artifactId>
    <version>3.4.0-SNAPSHOT</version>
  </parent>
  <artifactId>${artifact}</artifactId>
  <dependencies>${dependencies}
  </dependencies>
</project>
`;
const dependency = (groupId, artifactId, scope) => `
    <dependency><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId>${scope ? `<scope>${scope}</scope>` : ""}</dependency>`;

const files = {
  "README.md": "# Ledger service\n\nDouble-entry ledger API used by the payments and invoicing teams.\n\n```\nmvn -B verify\njava -jar ledger-app/target/ledger-app.jar\n```\n",
  "AGENTS.md": "# Ledger service\n\n- Build and test: `mvn -B verify` on JDK 11.\n- Money is `BigDecimal` with scale 2 and `RoundingMode.HALF_EVEN`.\n- Flyway migrations are immutable once released.\n- Use Lombok `@Value` for value objects.\n",
  ".github/agents/build.agent.md": "---\nname: build\ndescription: Maven build helper for the ledger service\ntools: ['read', 'search', 'edit', 'execute']\n---\nYou maintain the Maven build of the ledger service.\n\n- Run `mvn -B verify` before proposing a change.\n- Keep every plugin and dependency version in the root `pom.xml` (`pluginManagement` and `dependencyManagement`); module poms never declare versions.\n- Only Maven Central; never add another repository.\n",
  "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.contoso.ledger</groupId>
  <artifactId>ledger-parent</artifactId>
  <version>3.4.0-SNAPSHOT</version>
  <packaging>pom</packaging>
  <modules>
    <module>ledger-core</module>
    <module>ledger-persistence</module>
    <module>ledger-app</module>
  </modules>
  <properties>
    <maven.compiler.source>11</maven.compiler.source>
    <maven.compiler.target>11</maven.compiler.target>
    <lombok.version>1.18.20</lombok.version>
    <junit.version>5.8.2</junit.version>
    <mockito.version>3.12.4</mockito.version>
    <flyway.version>7.15.0</flyway.version>
    <postgresql.version>42.2.24</postgresql.version>
    <testcontainers.version>1.16.2</testcontainers.version>
  </properties>
  <build>
    <pluginManagement>
      <plugins>
        <plugin><artifactId>maven-compiler-plugin</artifactId><version>3.8.1</version></plugin>
        <plugin><artifactId>maven-surefire-plugin</artifactId><version>2.22.2</version></plugin>
        <plugin><groupId>org.jacoco</groupId><artifactId>jacoco-maven-plugin</artifactId><version>0.8.7</version></plugin>
      </plugins>
    </pluginManagement>
  </build>
</project>
`,
  "ledger-core/pom.xml": module("ledger-core", dependency("org.projectlombok", "lombok", "provided") + dependency("org.junit.jupiter", "junit-jupiter", "test") + dependency("org.mockito", "mockito-junit-jupiter", "test")),
  "ledger-core/src/main/java/com/contoso/ledger/core/Posting.java": "package com.contoso.ledger.core;\n\nimport java.math.BigDecimal;\nimport lombok.Value;\n\n@Value\npublic class Posting {\n    String account;\n    BigDecimal amount;\n    Side side;\n}\n",
  "ledger-core/src/main/java/com/contoso/ledger/core/LedgerService.java": "package com.contoso.ledger.core;\n\npublic class LedgerService {\n    public Journal post(List<Posting> postings) {\n        BigDecimal balance = postings.stream().map(p -> p.getSide() == Side.DEBIT ? p.getAmount() : p.getAmount().negate()).reduce(BigDecimal.ZERO, BigDecimal::add);\n        if (balance.signum() != 0) throw new UnbalancedJournalException(balance);\n        return new Journal(postings);\n    }\n}\n",
  "ledger-core/src/test/java/com/contoso/ledger/core/LedgerServiceTest.java": "package com.contoso.ledger.core;\n\nclass LedgerServiceTest {\n    @Test\n    void rejectsUnbalancedJournal() { assertThrows(UnbalancedJournalException.class, () -> new LedgerService().post(List.of(debit(\"cash\", \"10.00\")))); }\n}\n",
  "ledger-persistence/pom.xml": module("ledger-persistence", dependency("com.contoso.ledger", "ledger-core") + dependency("org.flywaydb", "flyway-core") + dependency("org.postgresql", "postgresql") + dependency("org.testcontainers", "postgresql", "test")),
  "ledger-persistence/src/main/java/com/contoso/ledger/persistence/JdbcLedgerRepository.java": "package com.contoso.ledger.persistence;\n\npublic class JdbcLedgerRepository {\n    private final DataSource dataSource;\n    public void save(Journal journal) { /* INSERT INTO posting ... in one transaction */ }\n}\n",
  "ledger-persistence/src/main/resources/db/migration/V1__ledger.sql": "CREATE TABLE journal (id BIGSERIAL PRIMARY KEY, posted_at TIMESTAMPTZ NOT NULL);\nCREATE TABLE posting (journal_id BIGINT REFERENCES journal(id), account TEXT NOT NULL, amount NUMERIC(19,2) NOT NULL, side CHAR(1) NOT NULL);\n",
  "ledger-persistence/src/test/java/com/contoso/ledger/persistence/JdbcLedgerRepositoryIT.java": "package com.contoso.ledger.persistence;\n\n@Testcontainers\nclass JdbcLedgerRepositoryIT {\n    @Container static PostgreSQLContainer<?> db = new PostgreSQLContainer<>(\"postgres:16\");\n}\n",
  "ledger-app/pom.xml": module("ledger-app", dependency("com.contoso.ledger", "ledger-persistence")),
  "ledger-app/src/main/java/com/contoso/ledger/app/LedgerApplication.java": "package com.contoso.ledger.app;\n\nimport com.sun.net.httpserver.HttpServer;\n\npublic class LedgerApplication {\n    public static void main(String[] args) throws Exception {\n        HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);\n        server.setExecutor(Executors.newFixedThreadPool(32));\n        server.createContext(\"/journals\", new JournalHandler());\n        server.start();\n    }\n}\n",
  "ledger-app/Dockerfile": "FROM eclipse-temurin:11-jre\nCOPY target/ledger-app.jar /app/ledger-app.jar\nEXPOSE 8080\nENTRYPOINT [\"java\", \"-jar\", \"/app/ledger-app.jar\"]\n",
  ".github/workflows/ci.yml": `name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "11"
          cache: maven
      - run: mvn -B -ntp verify
`,
};

const destination = {
  destination: "Contoso's ledger service: the double-entry ledger API the payments and invoicing teams call, upgraded from Java 11 to Java 21 (LTS) without changing its API, its numbers or its frameworks.",
  notes: [
    "Upgrade in small, reversible steps: build toolchain first, then libraries that block Java 21, then optional language modernisation in code that is touched anyway.",
    "Balances, rounding and the HTTP API must be identical before and after; the existing tests are the contract.",
    "The payments team deploys the container; they need two weeks' notice of the runtime image change.",
  ],
  decisions: [
    { topic: "Target", decision: "Java 21 (Eclipse Temurin) for build and runtime." },
    { topic: "Frameworks", decision: "No framework change: plain Java with the JDK HttpServer, JDBC and Flyway." },
    { topic: "Build", decision: "Maven stays; compile with `maven.compiler.release` 21." },
    { topic: "Language features", decision: "Records, pattern matching and switch expressions only after the toolchain change merges, and only in code a task touches anyway (recommended default)." },
    { topic: "Virtual threads", decision: "Not in this upgrade (assumed)." },
    { topic: "Container", decision: "eclipse-temurin:21-jre base image." },
  ],
  notYetSpecified: ["Whether the HTTP server moves to virtual threads later."],
  outOfScope: ["Moving to Spring Boot, Quarkus or another framework.", "Migrating the build to Gradle.", "Database schema changes."],
};

const agents = `# Ledger service

Double-entry ledger API (Maven multi-module: \`ledger-core\`, \`ledger-persistence\`, \`ledger-app\`) moving from Java 11 to Java 21. Project context and open decisions: \`docs/destination.md\`.

## Commands

- Build and test: \`mvn -B -ntp verify\` (persistence integration tests need Docker for Testcontainers).
- One module: \`mvn -B -ntp -pl ledger-core -am verify\`.
- Check on Java 21 while the default JDK is still 11: \`JAVA_HOME=$JAVA_HOME_21_X64 mvn -B -ntp verify\` (the setup workflow installs both).

## Rules

- Money is \`BigDecimal\` with scale 2 and \`RoundingMode.HALF_EVEN\`; never \`double\`.
- Flyway migrations are immutable once released; add a new \`V<n>__\` file instead.
- Plugin and dependency versions live only in the root \`pom.xml\`.
`;

const java = `---
applyTo: "**/*.java"
---
# Java code during the upgrade

- Until the root \`pom.xml\` sets \`maven.compiler.release\` to 21, write Java 11 only.
- After that, records, pattern matching for \`instanceof\` and \`switch\`, and text blocks are welcome in code a task already changes. Do not refactor untouched files to use them.
- Converting a Lombok \`@Value\` class to a record renames accessors (\`getAmount()\` becomes \`amount()\`); update every caller in the same change.
`;

const maven = `---
applyTo: "**/pom.xml"
---
# Maven build

- Compile with \`<maven.compiler.release>\`, not \`source\`/\`target\`; \`release\` also checks API use against the target JDK.
- Java 21 needs at least Lombok 1.18.30, Mockito 5 (Byte Buddy 1.14), JaCoCo 0.8.11 and Surefire 3; older versions fail on class file version 65.
- Upgrade one blocking library per commit so a failing test points to its cause.
`;

const migrations = `---
applyTo: "ledger-persistence/src/main/resources/db/migration/**"
---
# Flyway migrations

- Never edit or rename a released migration; Flyway validates checksums and production would refuse to start.
- The Java upgrade needs no schema change. A migration in an upgrade PR is a mistake.
`;

const finding = (area, path, assessment, recommendation, action, editPaths) => ({ area, path, assessment, recommendation, action, ...(editPaths ? { editPaths } : {}) });

export default {
  repository: "contoso/ledger-service",
  start: "mvn -B -ntp -pl ledger-app -am package && java -jar ledger-app/target/ledger-app.jar",
  files,
  destination,
  issue: {
    number: 31, updatedAt: "2026-03-06T08:05:00Z",
    title: "Run the ledger service on Java 21",
    body: "Java 11 support from our JDK vendor ends this year. Build, test and run the ledger service on Java 21 (Temurin).\n\n- No API, balance or rounding changes; the existing tests must pass unchanged.\n- No framework change.\n- Payments needs the new container image two weeks before production.\n",
  },
  plan: {
    summary: "Four tasks. The build platform first moves the compiler, plugins and libraries that block Java 21 and switches CI; the container image follows separately so payments can schedule it. Persistence and domain then verify and modernise their modules on Java 21, each in its own PR.",
    tasks: [
      { id: "toolchain", title: "Build and test on Java 21", owner: "build-platform", priority: 1, dependsOn: [],
        scope: "Set `maven.compiler.release` to 21 and upgrade Lombok, Mockito, JaCoCo, Surefire and Testcontainers to Java 21-compatible versions in the root `pom.xml`; switch `.github/workflows/ci.yml` to JDK 21.",
        acceptanceCriteria: ["`mvn -B -ntp verify` passes on JDK 21 with no test changed or skipped.", "Versions are declared only in the root `pom.xml`.", "No application code changes."] },
      { id: "container-image", title: "Run the container on Java 21", owner: "build-platform", priority: 2, dependsOn: ["toolchain"],
        scope: "Move `ledger-app/Dockerfile` to eclipse-temurin:21-jre.",
        acceptanceCriteria: ["The image builds and answers `/journals` on port 8080.", "The PR description gives payments the image tag to test."] },
      { id: "persistence-on-21", title: "Verify persistence on Java 21", owner: "persistence", priority: 2, dependsOn: ["toolchain"],
        scope: "Run and fix the `ledger-persistence` integration tests on JDK 21 with the upgraded Testcontainers, without changing migrations or the PostgreSQL driver major version.",
        acceptanceCriteria: ["`JdbcLedgerRepositoryIT` passes against PostgreSQL in Testcontainers on JDK 21.", "No migration file changes."] },
      { id: "domain-records", title: "Make Posting a record", owner: "ledger-domain", priority: 3, dependsOn: ["toolchain"],
        scope: "Replace the Lombok `@Value` Posting with a Java record and update every accessor call in the same change.",
        acceptanceCriteria: ["All callers use `account()`, `amount()` and `side()`.", "Balances and rounding are unchanged and all tests pass.", "JaCoCo line coverage of `ledger-core` does not drop."] },
    ],
  },
  review: () => ({
    summary: "Brownfield Maven multi-module service on Java 11 with a short AGENTS.md and one custom build agent. The upgrade to Java 21 mostly changes the build (compiler, plugins, Lombok, Mockito, JaCoCo, CI and image), so the existing build agent is adopted as the build-platform specialist. Domain and persistence code get their own owners because they change for different reasons, and a reviewer guards rounding and API parity.",
    findings: [
      finding("instructions", "AGENTS.md", "Accurate rules (money, migrations), but pins JDK 11 and prescribes Lombok `@Value`, which conflicts with records after the upgrade.", "Update it for the transition and move Java- and Maven-specific rules into path-scoped files.", "edit", ["AGENTS.md"]),
      finding("instructions", null, "No path-scoped guidance for Java sources, poms or migrations.", "Add scoped instructions for each.", "edit", [".github/instructions/java.instructions.md", ".github/instructions/maven.instructions.md", ".github/instructions/migrations.instructions.md"]),
      finding("agents", ".github/agents/build.agent.md", "Useful build rules (versions only in the root pom, Maven Central only) that match the upgrade's main work.", "Adopt it as crewbie-build-platform, keeping its instructions and tools.", "retain"),
      finding("mcp", null, "No MCP servers. The upgrade depends on exact library versions and migration notes.", "Add Context7 for version-specific library documentation (also for the cloud agent).", "edit"),
      finding("constitution", null, "The parity rules fit in AGENTS.md and the destination.", "No constitution for now.", "retain"),
    ],
    questions: [],
    assumptions: [
      "The cloud agent environment installs JDK 11 (default) and JDK 21 side by side until the toolchain change merges; afterwards the setup workflow should switch to 21 only.",
    ],
    roles: [
      {
        id: "build-platform", sourceAgent: ".github/agents/build.agent.md",
        purpose: "Own the build and runtime toolchain: the root `pom.xml`, module poms, plugin and dependency versions, `.github/workflows/ci.yml`, and the `ledger-app` packaging and `ledger-app/Dockerfile`.",
        model: "gpt-5.3-codex", complexity: "standard",
        modelReason: "Version bumps and build configuration are well-specified, tool-heavy work where a coding-tuned model is efficient.",
        knowledge: [
          "The root `pom.xml` uses `maven.compiler.source`/`target` 11, Lombok 1.18.20, Mockito 3.12.4, JaCoCo 0.8.7 and Surefire 2.22.2; all of these block or break on Java 21.",
          "Mockito 5 uses the inline mock maker; on Java 21 add `-XX:+EnableDynamicAgentLoading` to Surefire's argLine to silence the dynamic agent warning (JEP 451).",
          "Testcontainers 1.16 predates current Docker API versions; move to 1.19 or later with the upgrade.",
          "`.github/workflows/ci.yml` pins JDK 11 through actions/setup-java; switch it to 21 in the toolchain change.",
        ],
        checks: ["`mvn -B -ntp verify` passes on JDK 21 for all modules.", "The `ledger-app/Dockerfile` image starts and answers on port 8080."],
        nonNegotiables: ["Toolchain changes contain no refactoring of application code.", "No Flyway or PostgreSQL driver major upgrade in the same PR as the JDK change."],
        contextPaths: [],
      },
      {
        id: "ledger-domain", purpose: "Own `ledger-core`: postings, journals, balancing and rounding, including optional Java 21 language modernisation in code it changes.",
        model: "claude-sonnet-5.5", complexity: "standard",
        modelReason: "Small domain module with strong tests; careful but not deep reasoning.",
        knowledge: [
          "`ledger-core/src/main/java/com/contoso/ledger/core/Posting.java` is a Lombok `@Value` class; `LedgerService.java` calls `getSide()` and `getAmount()`, which become `side()` and `amount()` as a record.",
          "Balancing sums debits minus credits and rejects any non-zero balance; `ledger-core/src/test/java/com/contoso/ledger/core/LedgerServiceTest.java` covers the unbalanced case.",
        ],
        checks: ["`mvn -B -ntp -pl ledger-core verify` passes and JaCoCo line coverage does not drop."],
        nonNegotiables: ["Never change rounding, scale or balancing rules in an upgrade task."],
        contextPaths: [],
      },
      {
        id: "persistence", purpose: "Own `ledger-persistence`: the JDBC repository, Flyway migrations, the PostgreSQL driver and Testcontainers integration tests.",
        model: "gpt-5.3-codex", complexity: "standard",
        modelReason: "JDBC and migration work is mechanical but needs tests run against a real database.",
        knowledge: [
          "`ledger-persistence/src/main/resources/db/migration/V1__ledger.sql` stores amounts as `NUMERIC(19,2)`; the repository writes all postings of a journal in one transaction.",
          "Flyway 7 runs on Java 21. Flyway 10 and later need the separate `flyway-database-postgresql` artifact, so a later Flyway upgrade adds it in the same change.",
        ],
        checks: ["`ledger-persistence/src/test/java/com/contoso/ledger/persistence/JdbcLedgerRepositoryIT.java` passes against PostgreSQL in Testcontainers on JDK 21."],
        nonNegotiables: ["Never edit a released migration."],
        contextPaths: [],
      },
      {
        id: "ledger-reviewer", purpose: "Review each feature PR for unchanged balances, rounding and HTTP API behavior, reproducible builds and the one-concern-per-PR upgrade rule.",
        model: "gpt-6.1-sol", complexity: "standard",
        modelReason: "A different model family from the implementers gives an independent review at moderate cost.",
        knowledge: ["Accessor renames from Lombok to records compile but can break reflection-based JSON or JDBC mapping; check every use by name."],
        checks: ["Tests were not weakened or deleted to make the upgrade pass.", "The PR changes only what its task names: toolchain, one library or touched-code modernisation."],
        nonNegotiables: ["Block any PR that changes a balance, rounding mode or API response."],
        contextPaths: [],
      },
    ],
    reviewer: "ledger-reviewer",
    agentDecisions: [{ path: ".github/agents/build.agent.md", action: "adopt", reason: "Its build rules are exactly what the toolchain upgrade needs; keep them as the build-platform specialist." }],
    instructions: [
      { path: "AGENTS.md", content: agents, reason: "Keep the money and migration rules, replace the JDK 11 pin and the Lombok rule, and add the dual-JDK command." },
      { path: ".github/instructions/java.instructions.md", content: java, reason: "When Java 21 features become allowed, loaded only for Java sources." },
      { path: ".github/instructions/maven.instructions.md", content: maven, reason: "Java 21 build traps, loaded only for poms." },
      { path: ".github/instructions/migrations.instructions.md", content: migrations, reason: "Keep the upgrade from touching released migrations." },
    ],
    constitutionText: null,
    setupSteps: `name: Copilot setup steps
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
`,
    mcpServers: [
      { name: "context7", purpose: "Version-specific documentation and migration notes for Lombok, Mockito, JaCoCo, Flyway, Testcontainers and the JDK.", type: "local", command: "npx", args: ["-y", "@upstash/context7-mcp@4.4.2"], url: null, env: [], bearerSecret: null, tools: ["*"], cloud: true },
    ],
  }),
};
