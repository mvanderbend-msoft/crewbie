---
applyTo: "src/Contoso.Outdoor.Web.Core/**"
---
# ASP.NET Core host (.NET 10)

- Port one legacy controller and its views per change. Keep action names, route templates (`App_Start/RouteConfig.cs`), model binding and validation identical.
- Replace globals with DI: `HandleErrorAttribute` becomes the exception handler middleware, `RequireHttpsAttribute` becomes HTTPS redirection with a 302 status behind forwarded headers (Container Apps terminates TLS), bundles become static web assets.
- Keep `[ValidateAntiForgeryToken]` on every POST the legacy action had.
- Session and auth come from the legacy app through System.Web adapters (remote app); read `Session` through the adapter, never a second store.
- `/healthz/*` is served by the host itself, skips HTTPS redirection and is never forwarded.
- The YARP catch-all route stays last so every unmigrated path still reaches the legacy app.
