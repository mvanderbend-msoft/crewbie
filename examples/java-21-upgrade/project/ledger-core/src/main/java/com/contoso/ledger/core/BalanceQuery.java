package com.contoso.ledger.core;

import java.math.BigDecimal;
import java.util.Optional;

/** Port implemented by ledger-persistence. Empty means the account has no postings. */
public interface BalanceQuery {
    Optional<BigDecimal> sumFor(String account);
}
