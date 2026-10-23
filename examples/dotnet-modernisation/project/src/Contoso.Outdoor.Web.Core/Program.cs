using Azure.Monitor.OpenTelemetry.AspNetCore;
using Contoso.Outdoor.Data.Core;
using Contoso.Outdoor.Domain;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
var legacyUrl = builder.Configuration["Legacy:BaseUrl"] ?? throw new InvalidOperationException("Legacy:BaseUrl is not set.");

builder.Services.AddControllersWithViews(options => options.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));
builder.Services.AddOutdoorData(builder.Configuration);
builder.Services.AddHttpForwarder();
builder.Services.AddSystemWebAdapters()
    .AddJsonSessionSerializer(options =>
    {
        options.RegisterKey<Cart>(SessionKeys.Cart);
        options.RegisterKey<Address>(SessionKeys.Address);
    })
    .AddRemoteAppClient(options =>
    {
        options.RemoteAppUrl = new Uri(legacyUrl);
        options.ApiKey = builder.Configuration["Legacy:RemoteAppApiKey"]!;
    })
    .AddSessionClient()
    .AddAuthenticationClient(isDefaultScheme: true);

// Container Apps ingress terminates TLS; legacy RequireHttpsAttribute answered 302, so keep that status.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddHttpsRedirection(options => options.RedirectStatusCode = StatusCodes.Status302Found);

// Readiness checks only the database: a legacy outage must not restart the replicas serving ported routes.
builder.Services.AddHealthChecks().AddDbContextCheck<OutdoorDbContext>(tags: ["ready"]);
if (!string.IsNullOrEmpty(builder.Configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"]))
{
    builder.Services.AddOpenTelemetry().UseAzureMonitor();
}

var app = builder.Build();

app.UseForwardedHeaders();
app.UseWhen(context => !context.Request.Path.StartsWithSegments("/healthz"), branch => branch.UseHttpsRedirection());
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseSystemWebAdapters();

app.MapStaticAssets();
app.MapHealthChecks("/healthz/live", new() { Predicate = _ => false });
app.MapHealthChecks("/healthz/ready", new() { Predicate = check => check.Tags.Contains("ready") });

// Ported routes keep the templates of App_Start/RouteConfig.cs in the legacy app.
app.MapControllerRoute("Product", "p/{slug}", new { controller = "Catalog", action = "Product" });
app.MapControllerRoute("Default", "{controller=Catalog}/{action=Index}/{id?}");

// Every route without a ported action goes to the legacy app. Must stay last.
app.MapForwarder("/{**catch-all}", legacyUrl).Add(static endpoint => ((RouteEndpointBuilder)endpoint).Order = int.MaxValue);

app.Run();

public partial class Program;