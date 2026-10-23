# Contoso Outdoor store

Online store being migrated route by route from ASP.NET MVC 5 on .NET Framework 4.8 (`src/Contoso.Outdoor.Web`) to ASP.NET Core on .NET 10 (`src/Contoso.Outdoor.Web.Core`) on Azure Container Apps. Project context and open decisions: `docs/destination.md`.

## Commands

- Legacy app (Windows only): `nuget restore Contoso.Outdoor.sln`, then `msbuild Contoso.Outdoor.sln -restore /p:Configuration=Release` (`-restore` is needed for the SDK-style domain project); CI runs this in `.github/workflows/build.yml`.
- New projects (any OS): `dotnet build src/Contoso.Outdoor.Web.Core` and `dotnet test tests/Contoso.Outdoor.Web.Core.Tests`.
- Data parity tests (need Docker for the SQL Server container): `dotnet test tests/Contoso.Outdoor.Data.Core.Tests`.
- Infrastructure: `az bicep build --file infra/main.bicep`, then `azd provision --preview`. Deploys run only from `.github/workflows/deploy.yml`.
- Local run: `dotnet run --project src/Contoso.Outdoor.Web.Core`; unmigrated routes forward to the legacy app at `Legacy:BaseUrl`.

## Rules

- Public URLs, query strings and the `.Outdoor.Auth` cookie name never change; search engines and saved carts depend on them.
- Both apps share the SQL Server schema until cutover: no schema change the EF6 app cannot read.
- Prices round with `MidpointRounding.AwayFromZero` to 2 decimals (`src/Contoso.Outdoor.Domain/Pricing/PriceCalculator.cs`); keep it.
- Values both apps keep in session live in `src/Contoso.Outdoor.Domain` and are registered under the keys in `SessionKeys.cs` in both apps.
- Configuration comes from appsettings.json and environment variables; secrets come from Key Vault through managed identity, never from committed files.
