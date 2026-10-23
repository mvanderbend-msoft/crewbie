package com.contoso.ledger.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

class BoundedDataSourceTest {
    private final DataSource delegate = mock(DataSource.class);

    @Test
    void connectionBeyondTheLimitWaitsUntilOneCloses() throws Exception {
        when(delegate.getConnection()).thenAnswer(invocation -> mock(Connection.class));
        BoundedDataSource bounded = new BoundedDataSource(delegate, 2);
        Connection first = bounded.getConnection();
        bounded.getConnection();

        CompletableFuture<Connection> third = CompletableFuture.supplyAsync(() -> {
            try {
                return bounded.getConnection();
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
        });
        Thread.sleep(200);
        assertFalse(third.isDone());

        first.close();
        assertTrue(third.get(2, TimeUnit.SECONDS) != null);
    }

    @Test
    void failedOpenReleasesItsPermit() throws Exception {
        when(delegate.getConnection()).thenThrow(new SQLException("too many clients"));
        BoundedDataSource bounded = new BoundedDataSource(delegate, 1);
        assertThrows(SQLException.class, bounded::getConnection);
        assertEquals(1, bounded.available());
    }

    @Test
    void closingTwiceReleasesOnce() throws Exception {
        when(delegate.getConnection()).thenAnswer(invocation -> mock(Connection.class));
        BoundedDataSource bounded = new BoundedDataSource(delegate, 2);
        Connection connection = bounded.getConnection();
        connection.close();
        connection.close();
        assertEquals(2, bounded.available());
    }
}
