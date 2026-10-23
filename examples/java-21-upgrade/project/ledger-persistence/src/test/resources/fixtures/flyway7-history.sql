-- Captured with pg_dump from a staging database migrated by Flyway 7.15.0 (#52). Do not edit by hand.
CREATE TABLE journal (id BIGSERIAL PRIMARY KEY, posted_at TIMESTAMPTZ NOT NULL);
CREATE TABLE posting (journal_id BIGINT REFERENCES journal(id), account TEXT NOT NULL, amount NUMERIC(19,2) NOT NULL, side CHAR(1) NOT NULL);

CREATE TABLE flyway_schema_history (
    installed_rank INTEGER NOT NULL PRIMARY KEY,
    version VARCHAR(50),
    description VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL,
    script VARCHAR(1000) NOT NULL,
    checksum INTEGER,
    installed_by VARCHAR(100) NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT now(),
    execution_time INTEGER NOT NULL,
    success BOOLEAN NOT NULL
);
CREATE INDEX flyway_schema_history_s_idx ON flyway_schema_history (success);

INSERT INTO flyway_schema_history VALUES
    (1, '1', 'ledger', 'SQL', 'V1__ledger.sql', -1408329735, 'ledger', '2024-02-12 09:14:03', 41, true);
