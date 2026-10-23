package com.contoso.ledger.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.contoso.ledger.core.Posting;
import java.util.List;
import org.junit.jupiter.api.Test;

class JournalHandlerTest {
    @Test
    void parsesPostingLines() {
        assertEquals(List.of(Posting.debit("cash", "10.00"), Posting.credit("sales", "10.00")),
                JournalHandler.parse("cash,10.00,D\nsales,10.00,C\n"));
    }

    @Test
    void rejectsUnknownSide() {
        assertThrows(IllegalArgumentException.class, () -> JournalHandler.parse("cash,10.00,X"));
    }
}
