# .NET modernisation: MVC 5 to ASP.NET Core on Azure Container Apps

**Repository** (`contoso/outdoor-store`): an ASP.NET MVC 5 shop on .NET Framework 4.8. It contains `Contoso.Outdoor.Web` (Global.asax, OWIN cookie auth, InProc session), `Contoso.Outdoor.Data` (EF6), `Contoso.Outdoor.Domain` and MSTest tests. CI runs a Windows build. An outdated `.github/copilot-instructions.md` exists.

**Destination** (from Crewbie Compass): an incremental strangler-fig migration to ASP.NET Core on .NET 10. A YARP proxy and the System.Web adapters let the legacy app keep serving every route that has not been ported yet. Both apps share the SQL Server schema until cutover. The target platform is Azure Container Apps with managed identity, deployed with azd. URLs, cookies and prices must not change. See [`repo/docs/destination.md`](repo/docs/destination.md).

## Team

| Role | Model | Why this split |
| --- | --- | --- |
| `web-migration` | claude-opus-5.5 (complex) | Ports routes while the old and new hosts share auth and session; parity mistakes reach shoppers. |
| `data-access` | claude-sonnet-5.5 | EF6 to EF Core 10 against a schema both apps still use. |
| `cloud-platform` | gpt-6.1-sol | Dockerfile, Bicep, azd, Container Apps and OIDC deployment. |
| `migration-reviewer` | gpt-6.1-sol | Reviews feature PRs for parity, schema safety and Azure security, using a different model family from the main implementer. |

The team has no generic "frontend" or "backend" expert. Specialists are split by the concerns that change independently in this migration.

## Guidance

- `.github/copilot-instructions.md` is rewritten. The old file described only the legacy app.
- Path-scoped instructions: `legacy-web` (the frozen MVC 5 app), `aspnetcore` (the new host), `data`, and `infra`.
- `.crewbie/constitution.md`: parity, the shared schema, no secrets and the incremental cutover.
- `copilot-setup-steps.yml` installs the .NET 10 SDK for the cloud agent on Ubuntu. The legacy app builds only in the existing Windows CI.
- MCP servers in `.vscode/mcp.json`: Microsoft Learn (remote, also for the cloud agent) and Azure MCP (local).

## Issue to plan

[`issue.md`](issue.md) asks to serve the catalog from the new host. [`plan.json`](plan.json) splits that into five tasks:

1. `domain-multitarget` (web-migration)
2. `core-host-yarp` (web-migration)
3. `efcore-context` (data-access)
4. `container-infra` (cloud-platform), after the host exists
5. `catalog-routes` (web-migration), after the host, the data context and the shared domain are ready

Each task becomes its own issue and PR into the feature branch. The reviewer then checks the single feature PR.
