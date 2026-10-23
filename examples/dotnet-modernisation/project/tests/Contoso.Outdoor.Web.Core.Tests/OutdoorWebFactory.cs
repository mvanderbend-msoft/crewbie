using Contoso.Outdoor.Data.Core;
using Contoso.Outdoor.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Contoso.Outdoor.Web.Core.Tests;

/// <summary>
/// Runs the host against a stub legacy app (answers "legacy:{path}") and an in-memory SQLite copy of the catalog.
/// Remote session and auth are replaced by the adapters' wrapped ASP.NET Core session and a test sign-in.
/// </summary>
public sealed class OutdoorWebFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection connection = new("DataSource=:memory:");
    private readonly WebApplication legacy = LegacyStub();

    public OutdoorWebFactory()
    {
        connection.Open();
        legacy.StartAsync().GetAwaiter().GetResult();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Legacy:BaseUrl", legacy.Urls.First());
        builder.UseSetting("Legacy:RemoteAppApiKey", "test-only");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<OutdoorDbContext>>();
            services.AddDbContext<OutdoorDbContext>(options => options.UseSqlite(connection));
            services.AddSystemWebAdapters().AddWrappedAspNetCoreSession();
            services.AddTestSignIn();
        });
    }

    public void Seed(params Product[] products)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OutdoorDbContext>();
        db.Database.EnsureCreated();
        db.Products.AddRange(products);
        db.SaveChanges();
    }

    private static WebApplication LegacyStub()
    {
        var app = WebApplication.CreateBuilder().Build();
        app.Urls.Add("http://127.0.0.1:0");
        app.MapFallback(context => context.Response.WriteAsync($"legacy:{context.Request.Method} {context.Request.Path}"));
        return app;
    }

    protected override void Dispose(bool disposing)
    {
        legacy.DisposeAsync().AsTask().GetAwaiter().GetResult();
        connection.Dispose();
        base.Dispose(disposing);
    }
}