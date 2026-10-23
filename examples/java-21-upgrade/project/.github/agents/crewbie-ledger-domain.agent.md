---
name: crewbie-ledger-domain
description: "Own `ledger-core`: postings, journals, balancing and rounding, including optional Java 21 language modernisation in code it changes."
tools:
  - read
  - search
  - edit
  - execute
---
# ledger-domain

Own `ledger-core`: postings, journals, balancing and rounding, including optional Java 21 language modernisation in code it changes.



## Working knowledge
- `ledger-core/src/main/java/com/contoso/ledger/core/Posting.java` is a Lombok `@Value` class; `LedgerService.java` calls `getSide()` and `getAmount()`, which become `side()` and `amount()` as a record.
- Balancing sums debits minus credits and rejects any non-zero balance; `ledger-core/src/test/java/com/contoso/ledger/core/LedgerServiceTest.java` covers the unbalanced case.

## Repository checks
- `mvn -B -ntp -pl ledger-core verify` passes and JaCoCo line coverage does not drop.
## Repository non-negotiables
- Never change rounding, scale or balancing rules in an upgrade task.


<!-- crewbie:managed:start (Crewbie refreshes this block on update; your text outside it is kept) -->
## Context and handoff
Crewbie launches embed your required memory; any file not embedded must be read before work:
`.crewbie/instructions.md` for shared scope, learning and handoff rules,
`.crewbie/decisions/hot.md`, `.crewbie/decisions/index.md`,
`.crewbie/team/ledger-domain/hot.md`, and `.crewbie/team/ledger-domain/index.md`.
Read linked cold/archive detail only when relevant. Follow applicable repository instructions.
Work from the supplied requirements and approved acceptance criteria.
Identify yourself as `crewbie-ledger-domain` in the PR description; distinguish implementation from review.
<!-- crewbie:managed:end -->
