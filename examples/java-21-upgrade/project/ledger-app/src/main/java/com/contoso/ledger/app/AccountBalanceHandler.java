package com.contoso.ledger.app;

import com.contoso.ledger.core.BalanceResult;
import com.contoso.ledger.core.LedgerService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** GET /accounts/{account}/balance. The context matches every path under /accounts, so the full path is checked here. */
public class AccountBalanceHandler implements HttpHandler {
    // Raw path: getPath() would already have decoded %2F into '/'.
    private static final Pattern PATH = Pattern.compile("^/accounts/([^/]+)/balance$");

    private final LedgerService service;

    public AccountBalanceHandler(LedgerService service) {
        this.service = service;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        Matcher match = PATH.matcher(exchange.getRequestURI().getRawPath());
        if (!"GET".equals(exchange.getRequestMethod()) || !match.matches()) {
            Responses.send(exchange, 404, Map.of("error", "not found"));
            return;
        }
        String account = URLDecoder.decode(match.group(1), StandardCharsets.UTF_8);
        switch (service.balance(account)) {
            case BalanceResult.Found(var balance) -> {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("account", balance.account());
                body.put("balance", balance.amount().toPlainString());
                Responses.send(exchange, 200, body);
            }
            case BalanceResult.UnknownAccount(var unknown) -> Responses.send(exchange, 404, Map.of("error", "unknown account: " + unknown));
        }
    }
}
