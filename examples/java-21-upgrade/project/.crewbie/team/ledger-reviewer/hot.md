# ledger-reviewer: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- A green build says nothing about responses: `JsonWriter` is reflection-based, so require a JSON assertion for every class whose accessors change. <!-- source: #42 2026-08-29 -->
- Read the Failsafe summary in the CI log; integration tests that do not run leave `mvn verify` green. <!-- source: #42 2026-08-29 -->
- Money must leave the API through `toPlainString()`; `toString()` can print `1E+1` after arithmetic. <!-- source: #63 2026-09-26 -->
