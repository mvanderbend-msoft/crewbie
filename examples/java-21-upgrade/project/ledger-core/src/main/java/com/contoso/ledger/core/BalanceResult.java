package com.contoso.ledger.core;

/** Handlers switch over this without a default branch, so a new result fails to compile until every caller handles it. */
public sealed interface BalanceResult {

    record Found(Balance balance) implements BalanceResult {
    }

    record UnknownAccount(String account) implements BalanceResult {
    }
}
