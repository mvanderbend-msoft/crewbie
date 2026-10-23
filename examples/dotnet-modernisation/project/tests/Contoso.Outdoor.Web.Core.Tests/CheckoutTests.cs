using System.Net;

namespace Contoso.Outdoor.Web.Core.Tests;

public sealed class CheckoutTests(OutdoorWebFactory factory) : IClassFixture<OutdoorWebFactory>
{
    [Fact]
    public async Task Signed_out_shoppers_go_to_the_legacy_login_with_return_url()
    {
        var client = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        var response = await client.GetAsync("/Checkout");
        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        Assert.Equal("/Account/Login?ReturnUrl=%2FCheckout", response.Headers.Location!.PathAndQuery);
    }

    [Fact]
    public async Task Missing_address_fields_show_the_legacy_messages()
    {
        var client = factory.CreateSignedInClient();
        var form = await AntiforgeryForm.FromAsync(client, "/Checkout", new() { ["Name"] = "Test Shopper" });
        var html = await (await client.PostAsync("/Checkout", form)).Content.ReadAsStringAsync();
        Assert.Contains("Enter a street and house number.", html);
    }

    [Fact]
    public async Task Valid_address_redirects_back_to_checkout()
    {
        var client = factory.CreateSignedInClient(allowRedirect: false);
        var form = await AntiforgeryForm.FromAsync(client, "/Checkout",
            new() { ["Name"] = "Test Shopper", ["Street"] = "1 Test Lane", ["PostalCode"] = "0000 AA", ["City"] = "Testville" });
        var response = await client.PostAsync("/Checkout", form);
        Assert.Equal("/Checkout", response.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task PlaceOrder_is_still_forwarded_to_the_legacy_app()
    {
        var client = factory.CreateSignedInClient();
        var body = await (await client.PostAsync("/Checkout/PlaceOrder", new FormUrlEncodedContent([]))).Content.ReadAsStringAsync();
        Assert.Equal("legacy:POST /Checkout/PlaceOrder", body);
    }
}