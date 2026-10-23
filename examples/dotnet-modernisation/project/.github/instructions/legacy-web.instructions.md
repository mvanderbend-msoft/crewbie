---
applyTo: "src/Contoso.Outdoor.Web/**"
---
# Legacy MVC 5 app (frozen)

- This app is retired route by route. Change it only to keep an unmigrated route working or to share session and auth with the new host.
- It builds only on Windows with MSBuild and packages.config; do not convert it to SDK-style or PackageReference.
- When a route moves to `src/Contoso.Outdoor.Web.Core`, leave the legacy controller in place until cutover; YARP stops forwarding it instead.
