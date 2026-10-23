using System;
using System.Collections.Generic;
using System.Linq;

namespace Contoso.Outdoor.Domain
{
    public enum OrderStatus { PendingPayment = 0, Paid = 1, Cancelled = 2 }

    public class Order
    {
        public int Id { get; set; }
        public string CustomerEmail { get; set; }
        public DateTime CreatedUtc { get; set; }
        public OrderStatus Status { get; set; }
        public Address DeliveryAddress { get; set; }
        public decimal Total { get; set; }
        public virtual ICollection<OrderLine> Lines { get; set; } = new List<OrderLine>();

        public static Order Create(Cart cart, Address address, IEnumerable<Product> products)
        {
            var prices = products.ToDictionary(p => p.Id, p => p.Price);
            var lines = cart.Items.Where(i => prices.ContainsKey(i.ProductId))
                .Select(i => new OrderLine { ProductId = i.ProductId, Quantity = i.Quantity, UnitPrice = prices[i.ProductId] }).ToList();
            return new Order
            {
                CreatedUtc = DateTime.UtcNow, Status = OrderStatus.PendingPayment, DeliveryAddress = address, Lines = lines,
                Total = PriceCalculator.Total(lines.Select(l => new CartLine(l.UnitPrice, l.Quantity)), Vat.Standard),
            };
        }
    }

    public class OrderLine
    {
        public int Id { get; set; }
        public int ProductId { get; set; }
        public int Quantity { get; set; }
        public decimal UnitPrice { get; set; }
    }
}