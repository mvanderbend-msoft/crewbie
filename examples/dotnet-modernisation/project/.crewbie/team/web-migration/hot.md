# web-migration: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- The Windows build runs `msbuild -restore`: `nuget restore` reads only packages.config, so the SDK-style domain project has no restore assets and the legacy build fails. <!-- source: #19 2026-08-28 -->
- Keep `Order = int.MaxValue` on the YARP catch-all in `Program.cs`; without it the forwarder outranks conventional controller routes and ported pages silently go back to the legacy app. <!-- source: #20 2026-08-31 -->
- The legacy app needs `AddProxySupport(o => o.UseForwardedHeaders = true)` in `Global.asax.cs`; otherwise its redirects (sign-in, `RedirectToAction`) point at the internal legacy host. <!-- source: #20 2026-08-31 -->
- Container Apps terminates TLS: `UseForwardedHeaders` (known networks and proxies cleared) must run before HTTPS redirection, and the redirect status stays 302 because legacy `RequireHttpsAttribute` sent 302. <!-- source: #25 2026-09-08 -->
- Register every shared session key with `RegisterKey<T>` in both apps with the same type; an unregistered key comes back null instead of failing, so the cart just looks empty. <!-- source: #32 2026-09-17 -->
- Keep the global `AutoValidateAntiforgeryTokenAttribute`: ASP.NET Core does not validate tokens by default, so a missing attribute passes every test that does not post without a token on purpose. <!-- source: #36 2026-09-23 -->
- `/healthz/*` must skip HTTPS redirection: Container Apps probes call port 8080 over plain HTTP without `X-Forwarded-Proto`, so a 302 marks the revision unhealthy. <!-- source: #46 2026-10-09 -->
- MVC 5 and ASP.NET Core anti-forgery tokens are not interchangeable: a form rendered by one app cannot post to the other, so port a page and the POST it targets in the same feature. <!-- source: #54 2026-10-20 -->
