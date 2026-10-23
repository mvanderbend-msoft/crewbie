---
applyTo: "**/*.java"
---
# Java code

- Records, pattern matching for `instanceof` and `switch`, and text blocks are welcome in code a task already changes. Do not refactor untouched files to use them (`Journal` is still a Lombok class on purpose).
- Converting a Lombok `@Value` class to a record renames accessors (`getAmount()` becomes `amount()`); update every caller in the same change.
- `ledger-app/src/main/java/com/contoso/ledger/app/JsonWriter.java` builds API responses by reflection, so an accessor rename compiles but can change a response; assert the JSON of anything you convert.
