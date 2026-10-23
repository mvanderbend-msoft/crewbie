using Contoso.Outdoor.Data.Core;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SystemWebAdapters;

namespace Contoso.Outdoor.Web.Core.Controllers;

public sealed record CartViewModel(IReadOnlyList<PricedCartLine> Lines, decimal Total);

/// <summary>Port of the legacy CartController (#34). The cart stays in the legacy session.</summary>
public sealed class CartController(CartPricing pricing) : Controller
{
    [Session(IsReadOnly = true)]
    public async Task<IActionResult> Index()
    {
        var lines = await pricing.PriceAsync(HttpContext.GetCart(), HttpContext.RequestAborted);
        return View(new CartViewModel(lines, CartPricing.Total(lines)));
    }

    [HttpPost, ValidateAntiForgeryToken, Session]
    public IActionResult Add(int productId, int quantity)
    {
        HttpContext.SetCart(HttpContext.GetCart().Add(productId, quantity));
        return RedirectToAction("Index");
    }
}