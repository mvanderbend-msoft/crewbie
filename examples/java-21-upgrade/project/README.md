# Ledger service

Double-entry ledger API used by the payments and invoicing teams. Java 21 (Temurin), Maven, plain JDK `HttpServer`, JDBC, Flyway 10 and PostgreSQL.

```
mvn -B verify
java -jar ledger-app/target/ledger-app.jar
```

Configuration: `LEDGER_DB_URL`, `LEDGER_DB_USER`, `LEDGER_DB_PASSWORD`. Migrations run at start.

## API

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/journals` | Body: one `account,amount,side` line per posting (side `D` or `C`). `201` with the journal, `422` when it does not balance. |
| `GET` | `/accounts/{account}/balance` | `200` with `{"account": ..., "balance": "<debits minus credits>"}`, `404` when the account has no postings. |

Amounts are strings with two decimals.
