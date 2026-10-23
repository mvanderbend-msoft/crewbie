using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Contoso.Outdoor.Data.Core;

public static class DataServiceCollectionExtensions
{
    /// <summary>
    /// ConnectionStrings:Outdoor uses Authentication=Active Directory Default: the app's managed identity in Azure,
    /// the developer's Entra sign-in locally. It never contains a password.
    /// </summary>
    public static IServiceCollection AddOutdoorData(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<OutdoorDbContext>(options => options
            .UseSqlServer(configuration.GetConnectionString("Outdoor"), sql => sql.EnableRetryOnFailure())
            .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking));
        services.AddScoped<CatalogQueries>();
        services.AddScoped<CartPricing>();
        services.AddScoped<OrderWriter>();
        return services;
    }
}