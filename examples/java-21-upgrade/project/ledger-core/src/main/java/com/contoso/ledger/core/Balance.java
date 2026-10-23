package com.contoso.ledger.core;

import java.math.BigDecimal;

/** An account's balance: debits minus credits, scale 2. */
public record Balance(String account, BigDecimal amount) {
}
