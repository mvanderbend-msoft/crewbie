using Contoso.Outdoor.Data.Core;
using Contoso.Outdoor.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SystemWebAdapters;

namespace Contoso.Outdoor.Web.Core.Controllers;

public sealed record CheckoutViewModel(IReadOnlyList<PricedCartLine> Lines, decimal Total, Address? Address);

/// <summary>
/// Review and address step of the legacy CheckoutController (#54). PlaceOrder is not ported yet (#52, PR #56),
/// so it and the payment actions (Pay, Confirm) are still forwarded to the legacy app.
/// </summary>
[Authorize]
public sealed class CheckoutController(CartPricing pricing) : Controller
{
    [Session(IsReadOnly = true)]
    public Task<IActionResult> Index() => Review(HttpContext.GetAddress());

    [HttpPost, ValidateAntiForgeryToken, Session]
    public async Task<IActionResult> Index(Address address)
    {
        if (!ModelState.IsValid) return await Review(address);
        HttpContext.SetAddress(address);
        return RedirectToAction("Index");
    }

    private async Task<IActionResult> Review(Address? address)
    {
        var lines = await pricing.PriceAsync(HttpContext.GetCart(), HttpContext.RequestAborted);
        return View("Index", new CheckoutViewModel(lines, CartPricing.Total(lines), address));
    }
}