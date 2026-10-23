package com.contoso.ledger.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.contoso.ledger.core.Balance;
import com.contoso.ledger.core.Journal;
import com.contoso.ledger.core.Posting;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class JsonWriterTest {
    @Test
    void writesRecordsFromTheirComponents() {
        // Before #43 records were written as {} because they have no get* methods.
        assertEquals("{\"account\":\"cash\",\"amount\":\"10.00\",\"side\":\"DEBIT\"}", JsonWriter.write(Posting.debit("cash", "10.00")));
    }

    @Test
    void journalResponseIsUnchangedByTheRecordConversion() {
        Journal journal = new Journal(7L, Instant.parse("2026-08-31T10:00:00Z"), List.of(Posting.credit("sales", "10.00")));
        assertEquals("{\"id\":7,\"postedAt\":\"2026-08-31T10:00:00Z\",\"postings\":[{\"account\":\"sales\",\"amount\":\"10.00\",\"side\":\"CREDIT\"}]}",
                JsonWriter.write(journal));
    }

    @Test
    void moneyKeepsItsScale() {
        assertEquals("{\"account\":\"cash\",\"amount\":\"0.00\"}", JsonWriter.write(new Balance("cash", new BigDecimal("0.00"))));
    }
}
