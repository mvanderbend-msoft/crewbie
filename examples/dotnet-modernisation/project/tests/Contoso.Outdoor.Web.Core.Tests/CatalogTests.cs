using System.Net;
using Contoso.Outdoor.Domain;

namespace Contoso.Outdoor.Web.Core.Tests;

public sealed class CatalogTests : IClassFixture<OutdoorWebFactory>
{
    private readonly HttpClient client;

    public CatalogTests(OutdoorWebFactory factory)
    {
        factory.Seed(
            new Product { Id = 1, Slug = "trail-tent-2p", Name = "Trail tent 2P", Category = "tents", Price = 249.0000m },
            new Product { Id = 2, Slug = "alpine-tent-3p", Name = "Alpine tent 3P", Category = "tents", Price = 389.5000m });
        client = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    }

    [Fact]
    public async Task Product_page_shows_name_and_price()
    {
        var html = await client.GetStringAsync("/p/trail-tent-2p");
        Assert.Contains("Trail tent 2P", html);
        Assert.Contains("249.00", html);
    }

    [Fact]
    public async Task Unknown_slug_returns_404_not_the_legacy_error_page()
    {
        var response = await client.GetAsync("/p/no-such-tent");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Category_page_lists_products_by_name()
    {
        var html = await client.GetStringAsync("/Catalog?category=tents");
        Assert.True(html.IndexOf("Alpine tent 3P", StringComparison.Ordinal) < html.IndexOf("Trail tent 2P", StringComparison.Ordinal));
    }
}