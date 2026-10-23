# Shared decisions

Active cross-role choices only, one or two lines each: the choice and its reason, then the PR or file link in a trailing HTML comment. Replace superseded entries; move older detail to cold/ and link it from index.md. Link existing ADRs rather than copying them.

- Integration tests are named `*IT` and run by Failsafe in `mvn verify`; every module with database tests declares the plugin. <!-- source: #39 2026-08-28 -->
- API money is a JSON string with scale 2 written by `JsonWriter`; records are serialised from their components, other classes from getters. <!-- source: #43 2026-08-31 -->
- Build, CI, the cloud agent setup and the image use JDK 21 only; nothing may assume JDK 11 any more. <!-- source: #44 2026-09-02 -->
- One library per PR: the PostgreSQL driver never moves together with Flyway or the JDK, so a failing test points to one cause. <!-- source: #46 2026-09-07 -->
- No schema change, indexes included, until `docs/destination.md` allows it. <!-- source: #64 2026-10-09 -->
- HTTP moves to virtual threads with open database connections capped at 32 by the persistence layer instead of the thread pool ([why](cold/virtual-threads.md)). <!-- source: #64 2026-10-09 -->
