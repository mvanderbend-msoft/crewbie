package com.contoso.ledger.persistence;

import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;
import javax.sql.DataSource;

/**
 * Caps open connections. The fixed HTTP thread pool used to be the only limit; with virtual threads (#65) this is it.
 * A permit is released when the connection closes, or at once when opening it fails.
 */
public final class BoundedDataSource implements DataSource {
    private final DataSource delegate;
    private final Semaphore permits;

    public BoundedDataSource(DataSource delegate, int maxOpen) {
        this.delegate = delegate;
        this.permits = new Semaphore(maxOpen, true);
    }

    @Override
    public Connection getConnection() throws SQLException {
        permits.acquireUninterruptibly();
        try {
            return releasingOnClose(delegate.getConnection());
        } catch (SQLException | RuntimeException e) {
            permits.release();
            throw e;
        }
    }

    @Override
    public Connection getConnection(String user, String password) throws SQLException {
        throw new SQLFeatureNotSupportedException("Credentials come from the delegate");
    }

    int available() {
        return permits.availablePermits();
    }

    private Connection releasingOnClose(Connection connection) {
        AtomicBoolean released = new AtomicBoolean();
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, args) -> {
                    try {
                        return method.invoke(connection, args);
                    } catch (InvocationTargetException e) {
                        throw e.getCause();
                    } finally {
                        if (method.getName().equals("close") && released.compareAndSet(false, true)) permits.release();
                    }
                });
    }

    @Override public PrintWriter getLogWriter() throws SQLException { return delegate.getLogWriter(); }
    @Override public void setLogWriter(PrintWriter out) throws SQLException { delegate.setLogWriter(out); }
    @Override public void setLoginTimeout(int seconds) throws SQLException { delegate.setLoginTimeout(seconds); }
    @Override public int getLoginTimeout() throws SQLException { return delegate.getLoginTimeout(); }
    @Override public Logger getParentLogger() throws SQLFeatureNotSupportedException { return delegate.getParentLogger(); }
    @Override public <T> T unwrap(Class<T> type) throws SQLException { return delegate.unwrap(type); }
    @Override public boolean isWrapperFor(Class<?> type) throws SQLException { return delegate.isWrapperFor(type); }
}
