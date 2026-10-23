# Serve the catalog from the .NET 10 host on Azure Container Apps

First slice of the modernisation: the catalog and product pages (`/catalog`, `/p/{slug}`) are served by a new ASP.NET Core host on Azure Container Apps. Every other route keeps working through the legacy app.

- Shoppers see no difference: same URLs, same prices, same sign-in.
- The legacy app keeps running and keeps its Windows build.
- Deployed with azd; no secrets in the repository.
