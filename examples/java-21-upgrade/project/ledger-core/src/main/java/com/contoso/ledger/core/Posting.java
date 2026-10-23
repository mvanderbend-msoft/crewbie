package com.contoso.ledger.core;

import java.math.BigDecimal;
import java.util.Objects;

/** One leg of a journal. Converted from a Lombok {@code @Value} class in #41: accessors are {@code account()}, not {@code getAccount()}. */
public record Posting(String account, BigDecimal amount, Side side) {

    public Posting {
        Objects.requireNonNull(account, "account");
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(side, "side");
    }

    public static Posting debit(String account, String amount) {
        return new Posting(account, new BigDecimal(amount), Side.DEBIT);
    }

    public static Posting credit(String account, String amount) {
        return new Posting(account, new BigDecimal(amount), Side.CREDIT);
    }

    /** Debits count positive, credits negative. */
    public BigDecimal signedAmount() {
        return side == Side.DEBIT ? amount : amount.negate();
    }
}
