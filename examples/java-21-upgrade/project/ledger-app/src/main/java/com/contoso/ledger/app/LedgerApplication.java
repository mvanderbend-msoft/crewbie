package com.contoso.ledger.app;

import com.contoso.ledger.core.LedgerService;
import com.contoso.ledger.persistence.BoundedDataSource;
import com.contoso.ledger.persistence.FlywayMigrator;
import com.contoso.ledger.persistence.JdbcLedgerRepository;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.postgresql.ds.PGSimpleDataSource;

public class LedgerApplication {
    private static final int MAX_OPEN_CONNECTIONS = 32;

    public static void main(String[] args) throws Exception {
        PGSimpleDataSource postgres = new PGSimpleDataSource();
        postgres.setUrl(env("LEDGER_DB_URL", "jdbc:postgresql://localhost:5432/ledger"));
        postgres.setUser(env("LEDGER_DB_USER", "ledger"));
        postgres.setPassword(System.getenv("LEDGER_DB_PASSWORD"));
        DataSource dataSource = new BoundedDataSource(postgres, MAX_OPEN_CONNECTIONS);
        FlywayMigrator.migrate(dataSource);

        JdbcLedgerRepository repository = new JdbcLedgerRepository(dataSource);
        LedgerService service = new LedgerService(repository);

        HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);
        // Virtual threads replace this pool in task virtual-thread-executor of #65 (PR #72, not merged yet).
        server.setExecutor(Executors.newFixedThreadPool(32));
        server.createContext("/journals", new JournalHandler(service, repository));
        server.createContext("/accounts", new AccountBalanceHandler(service));
        server.start();
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
