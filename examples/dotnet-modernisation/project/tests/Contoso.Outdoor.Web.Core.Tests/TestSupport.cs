using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Contoso.Outdoor.Web.Core.Tests;

public static partial class AntiforgeryForm
{
    /// <summary>Loads a page the host renders and posts its anti-forgery token back with the given fields.</summary>
    public static async Task<FormUrlEncodedContent> FromAsync(HttpClient client, string page, Dictionary<string, string> fields)
    {
        var html = await client.GetStringAsync(page);
        fields["__RequestVerificationToken"] = Token().Match(html).Groups[1].Value;
        return new FormUrlEncodedContent(fields);
    }

    [GeneratedRegex("name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"")]
    private static partial Regex Token();
}

public static class TestSignIn
{
    public const string Header = "X-Test-Shopper";

    public static void AddTestSignIn(this IServiceCollection services) =>
        services.AddAuthentication(Handler.Scheme).AddScheme<AuthenticationSchemeOptions, Handler>(Handler.Scheme, null);

    public static HttpClient CreateSignedInClient(this OutdoorWebFactory factory, bool allowRedirect = true)
    {
        var client = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = allowRedirect });
        client.DefaultRequestHeaders.Add(Header, "shopper@example.test");
        return client;
    }

    private sealed class Handler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
            Task.FromResult(Request.Headers.TryGetValue(Header, out var email)
                ? AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, email!)], Scheme)), Scheme))
                : AuthenticateResult.NoResult());

        // Mirrors the legacy OWIN challenge the remote authentication client relays.
        protected override Task HandleChallengeAsync(AuthenticationProperties properties)
        {
            Response.Redirect($"/Account/Login?ReturnUrl={Uri.EscapeDataString(Request.Path)}");
            return Task.CompletedTask;
        }
    }
}