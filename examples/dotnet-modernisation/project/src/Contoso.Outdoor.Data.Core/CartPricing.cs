using Contoso.Outdoor.Domain;
using Microsoft.EntityFrameworkCore;

namespace Contoso.Outdoor.Data.Core;

public sealed record PricedCartLine(Product Product, int Quantity);

public sealed class CartPricing(OutdoorDbContext db)
{
    /// <summary>Current prices for the cart's products. Products that no longer exist are left out, as in the legacy cart.</summary>
    public async Task<IReadOnlyList<PricedCartLine>> PriceAsync(Cart cart, CancellationToken cancellationToken = default)
    {
        var ids = cart.Items.Select(i => i.ProductId).Distinct().ToList();
        var products = await db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        return cart.Items.Where(i => products.ContainsKey(i.ProductId))
            .Select(i => new PricedCartLine(products[i.ProductId], i.Quantity)).ToList();
    }

    public static decimal Total(IEnumerable<PricedCartLine> lines) =>
        PriceCalculator.Total(lines.Select(l => new CartLine(l.Product.Price, l.Quantity)), Vat.Standard);
}