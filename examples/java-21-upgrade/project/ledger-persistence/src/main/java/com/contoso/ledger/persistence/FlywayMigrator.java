package com.contoso.ledger.persistence;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;

/** Runs the migrations at application start. Clean stays disabled (the Flyway 9+ default); only tests enable it. */
public final class FlywayMigrator {
    private FlywayMigrator() {
    }

    public static MigrateResult migrate(DataSource dataSource) {
        return configure(dataSource).load().migrate();
    }

    static org.flywaydb.core.api.configuration.FluentConfiguration configure(DataSource dataSource) {
        return Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .validateMigrationNaming(true);
    }
}
