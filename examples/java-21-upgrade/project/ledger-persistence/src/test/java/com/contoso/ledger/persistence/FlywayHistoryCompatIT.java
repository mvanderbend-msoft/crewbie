package com.contoso.ledger.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Production's schema history was written by Flyway 7; Flyway 10 must accept it unchanged. */
@Testcontainers
class FlywayHistoryCompatIT {
    @Container
    static PostgreSQLContainer<?> db = new PostgreSQLContainer<>("postgres:16");

    @Test
    void flyway10ValidatesAFlyway7History() throws Exception {
        PGSimpleDataSource dataSource = new PGSimpleDataSource();
        dataSource.setUrl(db.getJdbcUrl());
        dataSource.setUser(db.getUsername());
        dataSource.setPassword(db.getPassword());
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute(fixture());
        }

        FlywayMigrator.configure(dataSource).load().validate();
        MigrateResult result = FlywayMigrator.migrate(dataSource);

        assertEquals(0, result.migrationsExecuted);
    }

    private static String fixture() throws Exception {
        try (var in = FlywayHistoryCompatIT.class.getResourceAsStream("/fixtures/flyway7-history.sql")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
