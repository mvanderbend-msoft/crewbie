using System.Net;
using Contoso.Outdoor.Domain;

namespace Contoso.Outdoor.Web.Core.Tests;

public sealed class CartTests(OutdoorWebFactory factory) : IClassFixture<OutdoorWebFactory>
{
    [Fact]
    public async Task Add_without_antiforgery_token_is_rejected()
    {
        var client = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost") });
        var response = await client.PostAsync("/Cart/Add", new FormUrlEncodedContent(new Dictionary<string, string> { ["productId"] = "1", ["quantity"] = "1" }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Add_redirects_to_the_cart_like_the_legacy_action()
    {
        factory.Seed(new Product { Id = 7, Slug = "camp-stove", Name = "Camp stove", Category = "cooking", Price = 10.0050m });
        var client = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        var form = await AntiforgeryForm.FromAsync(client, "/p/camp-stove", new() { ["productId"] = "7", ["quantity"] = "1" });

        var response = await client.PostAsync("/Cart/Add", form);

        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        Assert.Equal("/Cart", response.Headers.Location!.OriginalString);
        Assert.Contains("12.11", await client.GetStringAsync("/Cart"));
    }
}