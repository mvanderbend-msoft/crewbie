package com.contoso.ledger.app;

import com.contoso.ledger.core.Journal;
import com.contoso.ledger.core.LedgerService;
import com.contoso.ledger.core.Posting;
import com.contoso.ledger.core.Side;
import com.contoso.ledger.core.UnbalancedJournalException;
import com.contoso.ledger.persistence.JdbcLedgerRepository;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** POST /journals with lines of "account,amount,D|C". The request format predates this team and is part of the API. */
public class JournalHandler implements HttpHandler {
    private final LedgerService service;
    private final JdbcLedgerRepository repository;

    public JournalHandler(LedgerService service, JdbcLedgerRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod()) || !"/journals".equals(exchange.getRequestURI().getPath())) {
            Responses.send(exchange, 404, Map.of("error", "not found"));
            return;
        }
        try {
            Journal journal = service.post(parse(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            long id = repository.save(journal);
            Responses.send(exchange, 201, new Journal(id, journal.getPostedAt(), journal.getPostings()));
        } catch (UnbalancedJournalException e) {
            Responses.send(exchange, 422, Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            Responses.send(exchange, 400, Map.of("error", e.getMessage()));
        } catch (SQLException e) {
            Responses.send(exchange, 503, Map.of("error", "ledger unavailable"));
        }
    }

    static List<Posting> parse(String body) {
        List<Posting> postings = new ArrayList<>();
        for (String line : body.strip().split("\\R")) {
            String[] parts = line.split(",");
            if (parts.length != 3 || parts[2].length() != 1) throw new IllegalArgumentException("Bad posting line: " + line);
            postings.add(new Posting(parts[0].strip(), new BigDecimal(parts[1].strip()), Side.fromCode(parts[2].charAt(0))));
        }
        return postings;
    }
}
