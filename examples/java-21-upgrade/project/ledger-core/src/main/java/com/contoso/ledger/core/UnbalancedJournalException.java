package com.contoso.ledger.core;

import java.math.BigDecimal;

public class UnbalancedJournalException extends RuntimeException {
    private final BigDecimal balance;

    public UnbalancedJournalException(BigDecimal balance) {
        super("Journal does not balance: " + balance.toPlainString());
        this.balance = balance;
    }

    public BigDecimal getBalance() {
        return balance;
    }
}
