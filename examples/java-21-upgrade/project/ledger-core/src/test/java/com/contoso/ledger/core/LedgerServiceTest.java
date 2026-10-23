package com.contoso.ledger.core;

import static com.contoso.ledger.core.Posting.credit;
import static com.contoso.ledger.core.Posting.debit;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class LedgerServiceTest {
    private final LedgerService service = new LedgerService(account -> Optional.empty());

    @Test
    void rejectsUnbalancedJournal() {
        assertThrows(UnbalancedJournalException.class, () -> service.post(List.of(debit("cash", "10.00"))));
    }

    @Test
    void acceptsBalancedJournal() {
        Journal journal = service.post(List.of(debit("cash", "10.00"), credit("sales", "10.00")));
        assertEquals(2, journal.getPostings().size());
    }

    @Test
    void reportsTheImbalance() {
        var error = assertThrows(UnbalancedJournalException.class,
                () -> service.post(List.of(debit("cash", "10.00"), credit("sales", "9.99"))));
        // compareTo, not equals: BigDecimal.equals also compares scale.
        assertEquals(0, error.getBalance().compareTo(new BigDecimal("0.01")));
    }
}
