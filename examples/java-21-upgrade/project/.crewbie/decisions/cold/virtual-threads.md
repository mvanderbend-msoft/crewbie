# Virtual threads and database connections

Decided in #64 (destination update) and planned in #65.

## Why

During payout runs requests queue behind the fixed pool of 32 platform threads in `LedgerApplication`, while most of those threads wait on PostgreSQL. Virtual threads remove the queue at the HTTP layer at almost no memory cost.

## What the thread pool did implicitly

The pool size was also the only limit on open database connections: `PGSimpleDataSource` opens a new connection per `getConnection()` and there is no pool. With one virtual thread per request the number of concurrent connections would follow the request rate, and PostgreSQL rejects connections past its `max_connections`. The cap therefore moves to `ledger-persistence` before the executor changes: task `connection-limit` of #65 adds `BoundedDataSource`, a semaphore of 32 permits released when a connection closes or fails to open.

## Pinning

A virtual thread that blocks inside `synchronized` pins its carrier thread. The PostgreSQL driver at 42.2 guards socket I/O with `synchronized`; 42.6 and later use `ReentrantLock`. The driver upgrade stays within major version 42 and is its own PR (one library per PR). On JDK 21, `-Djdk.tracePinnedThreads=short` prints a stack trace when pinning happens; CI will run integration tests with it.

## Not decided

- Whether to add a real connection pool later. Out of scope for #65.
- The image with virtual threads ships only after payments has had it for two weeks.
