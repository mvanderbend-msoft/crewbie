public class RouteConfig
{
    public static void RegisterRoutes(RouteCollection routes)
    {
        routes.MapRoute("Product", "p/{slug}", new { controller = "Catalog", action = "Product" });
        routes.MapRoute("Default", "{controller}/{action}/{id}", new { controller = "Catalog", action = "Index", id = UrlParameter.Optional });
    }
}
