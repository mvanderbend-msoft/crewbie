using Contoso.Outdoor.Data.Core;
using Microsoft.AspNetCore.Mvc;

namespace Contoso.Outdoor.Web.Core.Controllers;

/// <summary>Port of the legacy CatalogController (#23). Unknown slugs return 404; see docs/destination.md.</summary>
public sealed class CatalogController(CatalogQueries catalog) : Controller
{
    public async Task<IActionResult> Index(string? category, int page = 1)
    {
        ViewBag.Category = category;
        return View(await catalog.PageAsync(category, page, HttpContext.RequestAborted));
    }

    public async Task<IActionResult> Product(string slug)
    {
        var product = await catalog.BySlugAsync(slug, HttpContext.RequestAborted);
        return product is null ? NotFound() : View(product);
    }
}