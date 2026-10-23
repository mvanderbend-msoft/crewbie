---
applyTo: "infra/**,azure.yaml,src/Contoso.Outdoor.Web.Core/Dockerfile"
---
# Azure infrastructure

- Bicep under `infra/`, deployed with azd. Parameters never contain secrets; use managed identity role assignments and Key Vault references.
- The container uses `mcr.microsoft.com/dotnet/aspnet:10.0` and listens on port 8080; Container Apps ingress terminates TLS.
- Assign least-privilege roles to the app's managed identity at resource scope.
