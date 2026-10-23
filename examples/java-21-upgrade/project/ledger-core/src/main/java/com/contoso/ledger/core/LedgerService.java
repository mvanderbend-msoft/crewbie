package com.contoso.ledger.core;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Optional;

public class LedgerService {
    private final BalanceQuery balances;

    public LedgerService(BalanceQuery balances) {
        this.balances = balances;
    }

    public Journal post(List<Posting> postings) {
        BigDecimal balance = postings.stream().map(Posting::signedAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (balance.signum() != 0) throw new UnbalancedJournalException(balance);
        return Journal.unsaved(postings);
    }

    public BalanceResult balance(String account) {
        Optional<BigDecimal> sum = balances.sumFor(account);
        return sum.<BalanceResult>map(amount -> new BalanceResult.Found(new Balance(account, amount.setScale(2, RoundingMode.HALF_EVEN))))
                .orElseGet(() -> new BalanceResult.UnknownAccount(account));
    }
}
