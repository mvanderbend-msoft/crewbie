package com.contoso.ledger.core;

public enum Side {
    DEBIT('D'),
    CREDIT('C');

    private final char code;

    Side(char code) {
        this.code = code;
    }

    /** The single character stored in {@code posting.side}. */
    public char code() {
        return code;
    }

    public static Side fromCode(char code) {
        return switch (code) {
            case 'D' -> DEBIT;
            case 'C' -> CREDIT;
            default -> throw new IllegalArgumentException("Unknown side code: " + code);
        };
    }
}
