# Contoso Outdoor store

Online store for Contoso Outdoor: catalog, cart, checkout and customer accounts.

The store is moving route by route from ASP.NET MVC 5 on .NET Framework 4.8 to ASP.NET Core on .NET 10 on Azure Container Apps (see `docs/destination.md`).

| Path | What it is |
| --- | --- |
| `src/Contoso.Outdoor.Web.Core` | New host. Serves ported routes and forwards everything else to the legacy app with YARP. |
| `src/Contoso.Outdoor.Web` | Legacy MVC 5 app on IIS. Frozen; kept until cutover. |
| `src/Contoso.Outdoor.Domain` | Shared domain (net48 and net10.0). |
| `src/Contoso.Outdoor.Data` / `Data.Core` | EF6 and EF Core 10 mappings of the same SQL Server schema. |
| `infra/` | Bicep for Container Apps, deployed with azd. |

Served by the new host today: `/`, `/Catalog`, `/p/{slug}`, `/Cart`, `/Checkout` (review and address). Everything else is forwarded.

## Build

- Legacy (Windows): `nuget restore Contoso.Outdoor.sln` then `msbuild Contoso.Outdoor.sln -restore /p:Configuration=Release`.
- New host: `dotnet test tests/Contoso.Outdoor.Web.Core.Tests`; data parity tests need Docker: `dotnet test tests/Contoso.Outdoor.Data.Core.Tests`.
- Run locally: `dotnet run --project src/Contoso.Outdoor.Web.Core` with `Legacy__BaseUrl` pointing at a running legacy app.