using System;
using System.Collections.Generic;
using System.Linq;

namespace Contoso.Outdoor.Domain
{
    public static class PriceCalculator
    {
        public static decimal Total(IEnumerable<CartLine> lines, decimal vatRate) => Math.Round(lines.Sum(l => l.Price * l.Quantity) * (1 + vatRate), 2, MidpointRounding.AwayFromZero);
    }
}