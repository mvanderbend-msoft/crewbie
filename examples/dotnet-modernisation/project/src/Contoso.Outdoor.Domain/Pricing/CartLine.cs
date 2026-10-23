namespace Contoso.Outdoor.Domain
{
    public sealed class CartLine
    {
        public CartLine(decimal price, int quantity) { Price = price; Quantity = quantity; }

        public decimal Price { get; }
        public int Quantity { get; }
    }

    public static class Vat
    {
        public const decimal Standard = 0.21m;
    }
}