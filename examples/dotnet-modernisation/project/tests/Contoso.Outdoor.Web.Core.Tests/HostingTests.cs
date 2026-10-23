using System.Net;

namespace Contoso.Outdoor.Web.Core.Tests;

public sealed class HostingTests(OutdoorWebFactory factory) : IClassFixture<OutdoorWebFactory>
{
    private readonly HttpClient https = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    private readonly HttpClient http = factory.CreateClient(new() { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false });

    [Theory]
    [InlineData("/Account/Login?returnUrl=%2FCart")]
    [InlineData("/Checkout/Pay/42")]
    public async Task Unported_routes_are_forwarded_to_the_legacy_app(string path)
    {
        Assert.StartsWith("legacy:GET /", await https.GetStringAsync(path));
    }

    [Fact]
    public async Task Plain_http_redirects_with_302_like_RequireHttpsAttribute()
    {
        var response = await http.GetAsync("/Catalog");
        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        Assert.Equal("https", response.Headers.Location!.Scheme);
    }

    [Fact]
    public async Task Forwarded_https_is_not_redirected()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/Catalog");
        request.Headers.Add("X-Forwarded-Proto", "https");
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Liveness_answers_over_plain_http_without_redirect()
    {
        var response = await http.GetAsync("/healthz/live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}