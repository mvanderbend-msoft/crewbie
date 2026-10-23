using System.Configuration;
using Contoso.Outdoor.Domain;
using Microsoft.AspNetCore.SystemWebAdapters;

namespace Contoso.Outdoor.Web
{
    public class MvcApplication : System.Web.HttpApplication
    {
        protected void Application_Start()
        {
            AreaRegistration.RegisterAllAreas();
            FilterConfig.RegisterGlobalFilters(GlobalFilters.Filters);
            RouteConfig.RegisterRoutes(RouteTable.Routes);
            BundleConfig.RegisterBundles(BundleTable.Bundles);

            // Lets the ASP.NET Core host read this app's session and sign-in during the migration.
            SystemWebAdapterConfiguration.AddSystemWebAdapters(this)
                .AddProxySupport(options => options.UseForwardedHeaders = true)
                .AddJsonSessionSerializer(options =>
                {
                    options.RegisterKey<Cart>(SessionKeys.Cart);
                    options.RegisterKey<Address>(SessionKeys.Address);
                })
                .AddRemoteAppServer(options => options.ApiKey = ConfigurationManager.AppSettings["RemoteAppApiKey"])
                .AddSessionServer()
                .AddAuthenticationServer();
        }
    }
}