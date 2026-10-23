using System.Collections.Generic;
using System.Linq;

namespace Contoso.Outdoor.Domain
{
    /// <summary>The shopper's cart, kept in the legacy session and serialised as JSON so both apps can read it.</summary>
    public sealed class Cart
    {
        public List<CartItem> Items { get; set; } = new List<CartItem>();

        public Cart Add(int productId, int quantity)
        {
            var existing = Items.FirstOrDefault(i => i.ProductId == productId);
            if (existing != null) existing.Quantity += quantity;
            else Items.Add(new CartItem { ProductId = productId, Quantity = quantity });
            return this;
        }

#if NETFRAMEWORK
        public static Cart From(System.Web.HttpSessionStateBase session) => session[SessionKeys.Cart] as Cart ?? new Cart();
#endif
    }

    public sealed class CartItem
    {
        public int ProductId { get; set; }
        public int Quantity { get; set; }
    }
}