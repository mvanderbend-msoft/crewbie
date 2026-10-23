package com.contoso.ledger.persistence;

import static com.contoso.ledger.core.Posting.credit;
import static com.contoso.ledger.core.Posting.debit;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.contoso.ledger.core.Journal;
import java.math.BigDecimal;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

// Named *IT so Failsafe runs it in `mvn verify`; Surefire's default includes would skip it.
@Testcontainers
class JdbcLedgerRepositoryIT {
    @Container
    static PostgreSQLContainer<?> db = new PostgreSQLContainer<>("postgres:16");

    private JdbcLedgerRepository repository;

    @BeforeEach
    void freshSchema() {
        PGSimpleDataSource dataSource = dataSource();
        Flyway flyway = FlywayMigrator.configure(dataSource).cleanDisabled(false).load();
        flyway.clean();
        flyway.migrate();
        repository = new JdbcLedgerRepository(dataSource);
    }

    @Test
    void savesAllPostingsOfAJournal() throws Exception {
        long id = repository.save(Journal.unsaved(List.of(debit("cash", "10.00"), credit("sales", "10.00"))));
        assertTrue(id > 0);
    }

    @Test
    void balanceIsDebitsMinusCredits() throws Exception {
        repository.save(Journal.unsaved(List.of(debit("cash", "25.50"), credit("sales", "25.50"))));
        repository.save(Journal.unsaved(List.of(debit("refunds", "5.25"), credit("cash", "5.25"))));
        assertEquals(new BigDecimal("20.25"), repository.sumFor("cash").orElseThrow());
        assertEquals(new BigDecimal("-25.50"), repository.sumFor("sales").orElseThrow());
    }

    @Test
    void accountWithoutPostingsHasNoBalance() {
        assertTrue(repository.sumFor("unused").isEmpty());
    }

    static PGSimpleDataSource dataSource() {
        PGSimpleDataSource dataSource = new PGSimpleDataSource();
        dataSource.setUrl(db.getJdbcUrl());
        dataSource.setUser(db.getUsername());
        dataSource.setPassword(db.getPassword());
        return dataSource;
    }
}
