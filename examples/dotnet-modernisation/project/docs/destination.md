# Destination

Contoso Outdoor's online store (catalog, cart, checkout and customer accounts for retail shoppers), moving from an ASP.NET MVC 5 / .NET Framework 4.8 monolith on on-premises IIS to ASP.NET Core on .NET 10 in Azure Container Apps without a big-bang cutover.

## Notes

- Shoppers must not notice the migration: URLs, cookies, sessions and checkout behavior stay the same during and after it.
- Migrate incrementally (strangler fig): a new ASP.NET Core host serves migrated routes and forwards the rest to the legacy app with YARP.
- The legacy app keeps running on IIS until every route is migrated; both apps share the SQL Server database until cutover.

## Decisions so far

- **Target framework**: .NET 10 (LTS) with ASP.NET Core MVC and Razor views (recommended default).
- **Incremental migration**: YARP fallback plus System.Web adapters to share session and authentication with the legacy app.
- **Hosting**: Azure Container Apps (Linux containers) behind Azure Front Door; Azure SQL Database after the data move.
- **Data access**: EF Core 10 mapped to the existing schema; no EF Core migrations until cutover (recommended default).
- **Secrets and identity**: Managed identity for Azure SQL and Key Vault; no passwords in configuration.
- **Infrastructure**: Bicep deployed with azd; GitHub Actions deploy with OIDC federated credentials.
- **Observability**: OpenTelemetry to Application Insights (assumed).
- **Unknown product slugs** (recorded on #24): the new host returns 404 for `/p/{slug}` with no product. The legacy app threw and answered 500 through `HandleErrorAttribute`; that was a bug, not behavior to keep.
- **Shared database until the data move** (recorded on #24): the database stays on CONTOSO-SQL01 (SQL Server 2022, Arc-enabled with Microsoft Entra authentication). The container app reaches it through the Container Apps environment's subnet and signs in with its managed identity.
- **Payment provider** (recorded with issue #47): stays in the legacy app (`/Checkout/Pay`, `/Checkout/Confirm`) until the provider's new SDK is approved; the new host hands off to it.

## Not yet specified

- Cutover date for the legacy IIS servers.
- Whether the back-office admin area migrates or is replaced.
- When the payment provider integration moves to the new host.

## Out of scope

- Rewriting the UI as a single-page app.
- Changing the catalog data model.
- Splitting the store into microservices.

<!-- Charted by crewbie init (Crewbie Compass interview). Keep it current: agents read it for project context and init reuses it. -->
