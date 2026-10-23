using Contoso.Outdoor.Domain;
using Microsoft.EntityFrameworkCore;

namespace Contoso.Outdoor.Data.Core;

public sealed class CatalogQueries(OutdoorDbContext db)
{
    public const int PageSize = 24;

    /// <summary>Same filter, order and paging as the legacy CatalogController.Index.</summary>
    public Task<List<Product>> PageAsync(string? category, int page, CancellationToken cancellationToken = default) =>
        db.Products.Where(p => p.Category == category).OrderBy(p => p.Name)
            .Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(cancellationToken);

    public Task<Product?> BySlugAsync(string slug, CancellationToken cancellationToken = default) =>
        db.Products.SingleOrDefaultAsync(p => p.Slug == slug, cancellationToken);
}