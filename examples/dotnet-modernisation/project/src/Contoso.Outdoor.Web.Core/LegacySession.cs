using Contoso.Outdoor.Domain;
using Microsoft.AspNetCore.SystemWebAdapters;

namespace Contoso.Outdoor.Web.Core;

/// <summary>Typed access to the legacy session through the System.Web adapters' remote session.</summary>
public static class LegacySession
{
    public static Cart GetCart(this HttpContext context) => context.AsSystemWeb().Session?[SessionKeys.Cart] as Cart ?? new Cart();

    public static void SetCart(this HttpContext context, Cart cart) => context.AsSystemWeb().Session![SessionKeys.Cart] = cart;

    public static Address? GetAddress(this HttpContext context) => context.AsSystemWeb().Session?[SessionKeys.Address] as Address;

    public static void SetAddress(this HttpContext context, Address address) => context.AsSystemWeb().Session![SessionKeys.Address] = address;
}