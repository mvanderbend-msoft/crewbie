package com.contoso.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class PostingTest {
    @Test
    void creditsAreNegative() {
        assertEquals("-10.00", Posting.credit("sales", "10.00").signedAmount().toPlainString());
    }

    @Test
    void sideRoundTripsThroughItsColumnCode() {
        for (Side side : Side.values()) assertEquals(side, Side.fromCode(side.code()));
    }

    @Test
    void rejectsMissingAmount() {
        assertThrows(NullPointerException.class, () -> new Posting("cash", null, Side.DEBIT));
    }
}
