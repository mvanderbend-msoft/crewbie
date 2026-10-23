---
applyTo: "**/*.java"
---
# Java code during the upgrade

- Until the root `pom.xml` sets `maven.compiler.release` to 21, write Java 11 only.
- After that, records, pattern matching for `instanceof` and `switch`, and text blocks are welcome in code a task already changes. Do not refactor untouched files to use them.
- Converting a Lombok `@Value` class to a record renames accessors (`getAmount()` becomes `amount()`); update every caller in the same change.
