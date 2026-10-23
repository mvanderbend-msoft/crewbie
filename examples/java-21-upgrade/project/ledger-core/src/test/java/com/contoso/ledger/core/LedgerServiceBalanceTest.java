package com.contoso.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class LedgerServiceBalanceTest {
    @Mock
    BalanceQuery balances;

    @Test
    void foundBalanceHasScaleTwo() {
        when(balances.sumFor("cash")).thenReturn(Optional.of(new BigDecimal("12.345")));
        var result = new LedgerService(balances).balance("cash");
        assertEquals(new BalanceResult.Found(new Balance("cash", new BigDecimal("12.34"))), result);
    }

    @Test
    void creditBalanceIsNegative() {
        when(balances.sumFor("sales")).thenReturn(Optional.of(new BigDecimal("-40")));
        var result = (BalanceResult.Found) new LedgerService(balances).balance("sales");
        assertEquals("-40.00", result.balance().amount().toPlainString());
    }

    @Test
    void accountWithoutPostingsIsUnknown() {
        when(balances.sumFor("unused")).thenReturn(Optional.empty());
        assertEquals(new BalanceResult.UnknownAccount("unused"), new LedgerService(balances).balance("unused"));
    }
}
