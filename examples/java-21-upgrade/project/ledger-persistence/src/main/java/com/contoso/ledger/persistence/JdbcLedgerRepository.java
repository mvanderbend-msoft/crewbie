package com.contoso.ledger.persistence;

import com.contoso.ledger.core.BalanceQuery;
import com.contoso.ledger.core.Journal;
import com.contoso.ledger.core.Posting;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.Optional;
import javax.sql.DataSource;

public class JdbcLedgerRepository implements BalanceQuery {
    private static final String BALANCE =
            "SELECT SUM(CASE side WHEN 'D' THEN amount ELSE -amount END) FROM posting WHERE account = ?";

    private final DataSource dataSource;

    public JdbcLedgerRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** Writes the journal and all its postings in one transaction. */
    public long save(Journal journal) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                long id = insertJournal(connection, journal);
                try (PreparedStatement insert = connection.prepareStatement(
                        "INSERT INTO posting (journal_id, account, amount, side) VALUES (?, ?, ?, ?)")) {
                    for (Posting posting : journal.getPostings()) {
                        insert.setLong(1, id);
                        insert.setString(2, posting.account());
                        insert.setBigDecimal(3, posting.amount());
                        insert.setString(4, String.valueOf(posting.side().code()));
                        insert.addBatch();
                    }
                    insert.executeBatch();
                }
                connection.commit();
                return id;
            } catch (SQLException e) {
                connection.rollback();
                throw e;
            }
        }
    }

    @Override
    public Optional<BigDecimal> sumFor(String account) {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement query = connection.prepareStatement(BALANCE)) {
            query.setString(1, account);
            try (ResultSet rows = query.executeQuery()) {
                rows.next();
                // SUM over no rows is one row holding NULL, not an empty result.
                return Optional.ofNullable(rows.getBigDecimal(1));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Balance query failed for " + account, e);
        }
    }

    private static long insertJournal(Connection connection, Journal journal) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement(
                "INSERT INTO journal (posted_at) VALUES (?)", Statement.RETURN_GENERATED_KEYS)) {
            insert.setTimestamp(1, Timestamp.from(journal.getPostedAt()));
            insert.executeUpdate();
            try (ResultSet keys = insert.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }
}
