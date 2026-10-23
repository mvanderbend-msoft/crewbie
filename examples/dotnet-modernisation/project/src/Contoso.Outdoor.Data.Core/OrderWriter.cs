using Contoso.Outdoor.Domain;

namespace Contoso.Outdoor.Data.Core;

/// <summary>Writes a pending order the legacy payment pages (/Checkout/Pay, /Checkout/Confirm) can read.</summary>
public sealed class OrderWriter(OutdoorDbContext db, CartPricing pricing)
{
    public async Task<Order> PlaceAsync(Cart cart, Address address, string customerEmail, CancellationToken cancellationToken = default)
    {
        var lines = await pricing.PriceAsync(cart, cancellationToken);
        var order = Order.Create(cart, address, lines.Select(l => l.Product));
        order.CustomerEmail = customerEmail;

        // One SaveChanges writes the order and its lines in one transaction; an explicit transaction would
        // conflict with EnableRetryOnFailure.
        db.Orders.Add(order);
        await db.SaveChangesAsync(cancellationToken);
        return order;
    }
}