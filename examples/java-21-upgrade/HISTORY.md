# History: contoso/ledger-service with Crewbie

From `crewbie init` (2026-08-24) to today (2026-10-23). Issues and PRs share one GitHub counter. `project/` shows the
feature branch of the plan in progress, `crewbie/issue-65-29ee5521`: `main` plus the two merged task PRs of #65.

## Week of 2026-08-24: init

- **#32** `crewbie init` (human). Adopted `.github/agents/build.agent.md` as `crewbie-build-platform`, added
  `ledger-domain`, `persistence` and the `ledger-reviewer`, rewrote `AGENTS.md`, added the `java`, `maven` and
  `migrations` instructions, Context7 and a setup workflow with JDK 21 and 11 side by side. Merged **2026-08-24**.
  What init proposed: [setup/crewbie-setup.md](setup/crewbie-setup.md).

## Plan 1: Run the ledger service on Java 21 (#31), 2026-08-25 to 2026-09-01

- **#31** (opened in March, before Crewbie). Edited on 2026-08-25 to add the payments notice and labelled
  `crewbie:ready-for-planning`.
- **#33** plan PR from `crewbie/plans/run-the-ledger-service-on-java-21-issue-31-7c41e09ab2d356f8`, adding
  `.crewbie/plans/run-the-ledger-service-on-java-21-issue-31/`. Four tasks; feature branch `crewbie/issue-31-abfdb862`.
  The coordinator gave `container-image` priority 2 so payments' two-week clock starts early. Added coordinator memory:
  "give the image task the highest priority". Merged by a human **2026-08-26**.
- **#34 / #35** `toolchain` (`crewbie-build-platform`). `maven.compiler.release` 21; Lombok, Mockito 5, Surefire 3,
  Testcontainers and the JaCoCo plugin upgraded in the root `pom.xml`; CI on JDK 21.
  - Bump: the first CI run failed in every module with `Unsupported class file major version 65` from JaCoCo 0.8.7. The
    agent moved JaCoCo to 0.8.12 in the same PR.
  - Bump: the next run was green but coverage read 0%: the new Surefire `<argLine>` for Mockito's inline mock maker
    had replaced JaCoCo's agent. Fixed with `@{argLine} -XX:+EnableDynamicAgentLoading`.
  - Memory: "argLine must start with `@{argLine}`", "keep `-XX:+EnableDynamicAgentLoading`", plus the cold topic
    `cold/java-21-build-traps.md`. Decision (later replaced by #44): "CI builds on 21; the agent setup keeps 11 as
    default until the image ships". Merged into the feature branch **2026-08-27**.
- **#36 / #37** `container-image` (`crewbie-build-platform`). `eclipse-temurin:21-jre`; copies `target/lib`. The PR
  description gave payments the tag and, after they asked in a comment, the digest. Memory: "copy `target/lib`",
  "give the digest, not only the tag". Merged **2026-08-28**.
- **#38 / #39** `persistence-on-21` (`crewbie-persistence`). The agent found that `JdbcLedgerRepositoryIT` had never run:
  no module declared Failsafe. Enabling it exposed a real bug (`side` written as `DEBIT` into `CHAR(1)`), fixed in
  the same PR, and added Failsafe to the root `pluginManagement`. Memory: "`side` is `CHAR(1)` holding `D`/`C`",
  build-platform "`mvn test` never runs `*IT`". Decision: "integration tests are `*IT`, run by Failsafe". Merged
  **2026-08-28**.
- **#40 / #41** `domain-records` (`crewbie-ledger-domain`). The task did not start (the cloud agent assignment timed
  out); a human added `crewbie:restart` to #40 on 2026-08-28 and it started within minutes. `Posting` became a record;
  all callers use `account()`, `amount()`, `side()`. Memory: "`BigDecimal.equals` compares scale". Merged
  **2026-08-29**.
- **#42** feature PR to `main`. `crewbie-ledger-reviewer` requested changes: `ledger-app` built JSON by reflection from
  `get*` methods, so a `Posting` record serialised as `{}` and `POST /journals` would have lost every posting. It also
  asked for the Failsafe summary to be checked in the CI log. Reviewer memory: "require a JSON assertion",
  "read the Failsafe summary"; ledger-domain memory: "`Journal` stays a Lombok class".
  - A human commented `/crewbie fix keep the response identical and add a test for it` on 2026-08-30.
  - **#43** fix task PR (`crewbie-ledger-domain`): `JsonWriter` reads record components; `JsonWriterTest` pins the
    `/journals` response. Memory: "`JsonWriter` reads records by component". Decision: "API money is a JSON string with
    scale 2". Merged into the feature branch **2026-08-31**.
  - The reviewer approved. Merged by a human **2026-09-01**. Production switched to the new image on 2026-09-15.

## Follow-up, 2026-09-02

- **#44** (human). Setup workflow installs only JDK 21; `AGENTS.md` drops the dual-JDK command and records the `*IT`
  convention; `java.instructions.md` drops the "Java 11 until release is 21" rule and adds the `JsonWriter` trap. The
  #35 decision was replaced by "JDK 21 only everywhere". Merged **2026-09-02**.

## Plan 2: Upgrade Flyway to 10 (#45), 2026-09-07 to 2026-09-11

- **#45** labelled 2026-09-07.
- **#46** plan PR from `crewbie/plans/upgrade-flyway-to-10-issue-45-e2b8f50d9a13c674`. The first version had two tasks.
  A human commented `/crewbie revise add a test that proves production's Flyway 7 schema history still validates`; the
  coordinator added `history-compat`. Coordinator memory: "prove a library upgrade against production's existing
  state". Decision: "one library per PR". Merged **2026-09-08**; feature branch `crewbie/issue-45-2d47096d`.
- **#47 / #48** `flyway-10` (`crewbie-build-platform`). Flyway 10.17.3 and `flyway-database-postgresql` managed in the
  root pom; driver unchanged. Merged **2026-09-09**.
- **#49 / #50** `migrator-on-10` (`crewbie-persistence`). CI failed: `Unable to execute clean as it has been disabled`;
  fixed in the same PR by enabling clean in the IT only. Memory: "`cleanDisabled` defaults to true". The agent also
  posted a `<!-- crewbie-memory-proposal -->` comment for build-platform: a mismatched `flyway-database-postgresql`
  version only fails at start. Merged **2026-09-10**.
- **#51 / #52** `history-compat` (`crewbie-persistence`). `FlywayHistoryCompatIT` with a pg_dump fixture captured from
  staging. Memory: "the fixture holds V1's Flyway 7 checksum". Merged **2026-09-10**.
- **#53** feature PR. The reviewer approved with no findings. Merged by a human **2026-09-11**.
- **#54** improver PR (a human ran `crewbie-maintain.yml`; nightly runs are off in `config.json`). It turned the #50
  proposal into a build-platform entry: "manage `flyway-database-postgresql` with `${flyway.version}`". Merged
  **2026-09-15**.

## Plan 3: Show an account's balance (#55), 2026-09-21 to 2026-09-29

- **#55** labelled 2026-09-21.
- **#56** plan PR from `crewbie/plans/show-an-account-s-balance-issue-55-41fd0c7e85a92b13`. No role owns HTTP handlers,
  so the coordinator gave the endpoint to ledger-domain and recorded that in its memory. Merged **2026-09-22**;
  feature branch `crewbie/issue-55-d8fdd1d9`.
- **#57 / #58** `balance-domain` (`crewbie-ledger-domain`). `Balance`, sealed `BalanceResult`, `BalanceQuery`,
  `LedgerService.balance`. Memory: "switch over `BalanceResult` without a `default`". Merged **2026-09-23**.
- **#59 / #60** `balance-query` (`crewbie-persistence`). One `SUM(CASE ...)` query. Memory: "`SUM` over no rows is
  NULL", "no index on `posting.account`; raise it instead of adding a migration". Merged **2026-09-24**.
- **#61 / #62** `balance-endpoint` (`crewbie-ledger-domain`). CI failed on the new `otherPathsUnderTheContextAre404`
  test (`createContext` matches by prefix); fixed in the same PR, which also moved to `getRawPath()` for encoded
  account names. Memory: both traps. Merged **2026-09-25**.
- **#63** feature PR. The reviewer approved, noting that money must go through `toPlainString()` (reviewer memory) and
  that balance queries scan `posting`. Merged by a human **2026-09-29**.

## Follow-up, 2026-10-09

- **#64** (human). `docs/destination.md`: virtual threads decided, the `posting.account` index added as the open
  question. Decisions: "no schema change until the destination allows it" and "virtual threads with connections capped
  at 32", with the shared cold topic `decisions/cold/virtual-threads.md`. Merged **2026-10-09**.

## Plan 4: Serve HTTP requests on virtual threads (#65), in progress

- **#65** labelled 2026-10-13.
- **#66** plan PR from `crewbie/plans/serve-http-requests-on-virtual-threads-issue-65-9b06d3e1f4a7c285`. Four tasks;
  feature branch `crewbie/issue-65-29ee5521`. Merged **2026-10-14**.
- **#67 / #68** `driver-no-pinning` (`crewbie-persistence`). PostgreSQL driver 42.2.24 to 42.7.4, nothing else. Memory:
  "keep the driver at 42.6 or later". Merged into the feature branch **2026-10-15**.
- **#69 / #70** `connection-limit` (`crewbie-persistence`). `BoundedDataSource`, wired into `LedgerApplication`. CI failed
  once: a failed `getConnection()` kept its permit; fixed in the same PR. Memory: "release the permit when
  `getConnection()` throws". Merged into the feature branch **2026-10-16**.
- **#71 / #72** `virtual-thread-executor` (`crewbie-build-platform`). Started 2026-10-16 but the assignment failed;
  `crewbie:restart` on 2026-10-21. PR #72 opened 2026-10-22; its first `ci / verify` run timed out in
  `JdbcLedgerRepositoryIT` and the agent is still working on it. **Open.**
- `pinning-check` (`crewbie-build-platform`) waits for #72; no task issue yet.

## Where things stand

- On `main`: Java 21 everywhere, Flyway 10, and `GET /accounts/{account}/balance`.
- On `crewbie/issue-65-29ee5521` (shown in `project/`): additionally PostgreSQL driver 42.7.4 and `BoundedDataSource`.
  `LedgerApplication` still uses the fixed pool of 32 threads, because #72 has not merged, and CI does not trace
  pinned threads yet (`pinning-check` has not started).
- Next for #65: #72 merges, `pinning-check` starts, then Crewbie opens the feature PR. Payments gets the image tag and
  digest from #72 and needs two weeks before production.
- Next per `docs/destination.md`: decide whether an index on `posting.account` is allowed. That would be the first
  schema change since V1 and needs the destination's out-of-scope line changed first.
