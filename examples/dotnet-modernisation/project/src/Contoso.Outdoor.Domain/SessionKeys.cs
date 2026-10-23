namespace Contoso.Outdoor.Domain
{
    /// <summary>Session keys both apps register with the System.Web adapters' JSON session serializer.</summary>
    public static class SessionKeys
    {
        public const string Cart = "cart";
        public const string Address = "checkout-address";
    }
}