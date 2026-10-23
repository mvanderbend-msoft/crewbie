package com.contoso.ledger.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.contoso.ledger.core.LedgerService;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class AccountBalanceHandlerTest {
    private final ByteArrayOutputStream body = new ByteArrayOutputStream();

    private HttpExchange get(String rawPath) {
        HttpExchange exchange = mock(HttpExchange.class);
        when(exchange.getRequestMethod()).thenReturn("GET");
        when(exchange.getRequestURI()).thenReturn(URI.create(rawPath));
        when(exchange.getResponseHeaders()).thenReturn(new Headers());
        when(exchange.getResponseBody()).thenReturn(body);
        return exchange;
    }

    private final LedgerService service = new LedgerService(account ->
            account.equals("cash/eur") ? Optional.of(new BigDecimal("20.25")) : Optional.empty());

    @Test
    void knownAccountReturnsItsBalance() throws Exception {
        HttpExchange exchange = get("/accounts/cash%2Feur/balance");
        new AccountBalanceHandler(service).handle(exchange);
        verify(exchange).sendResponseHeaders(200, body.size());
        assertEquals("{\"account\":\"cash/eur\",\"balance\":\"20.25\"}", body.toString(StandardCharsets.UTF_8));
    }

    @Test
    void unknownAccountIs404() throws Exception {
        HttpExchange exchange = get("/accounts/unused/balance");
        new AccountBalanceHandler(service).handle(exchange);
        verify(exchange).sendResponseHeaders(404, body.size());
    }

    @Test
    void otherPathsUnderTheContextAre404() throws Exception {
        HttpExchange exchange = get("/accounts/cash/balance/extra");
        new AccountBalanceHandler(service).handle(exchange);
        verify(exchange).sendResponseHeaders(eq(404), anyLong());
    }
}
