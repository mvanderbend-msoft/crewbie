# Crewbie assessment

Brownfield .NET Framework 4.8 MVC 5 store with one outdated instruction file and no agents or MCP servers. The work is an incremental migration to ASP.NET Core on .NET 10 in Azure Container Apps, so the crew is split by what changes together during a strangler-fig migration: web routes and views, data access, and Azure platform, plus a reviewer focused on behavior parity.

## Assumptions

Copilot chose these defaults where evidence or answers were missing. Correct any that are wrong in the guidance or roles before applying.

- The new host lives in `src/Contoso.Outdoor.Web.Core/` with tests in `tests/Contoso.Outdoor.Web.Core.Tests/`, and the EF Core port in `src/Contoso.Outdoor.Data.Core/`.
- Infrastructure is created under `infra/` with `azure.yaml` at the root, and the container definition is `src/Contoso.Outdoor.Web.Core/Dockerfile`.
- The legacy projects build only on Windows. Cloud agents run on Ubuntu, so they build and test the new .NET 10 projects, and the existing Windows job in .github/workflows/build.yml keeps verifying the legacy app.

## Destination (docs/destination.md)

Charted in the setup interview. Installed only when the file does not exist yet.

```markdown
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

## Not yet specified

- Cutover date for the legacy IIS servers.
- Whether the back-office admin area migrates or is replaced.

## Out of scope

- Rewriting the UI as a single-page app.
- Changing the catalog data model.
- Splitting the store into microservices.

<!-- Charted by crewbie init (Crewbie Compass interview). Keep it current: agents read it for project context and init reuses it. -->
```

## Proposed crew

| Specialist | Action | Model | Responsibility |
| --- | --- | --- | --- |
| web-migration | New specialist | claude-opus-5.5 | Own the route-by-route port from `src/Contoso.Outdoor.Web` (MVC 5) to `src/Contoso.Outdoor.Web.Core` (ASP.NET Core, .NET 10): controllers, Razor views, filters, YARP forwarding and System.Web adapters, plus multi-targeting `src/Contoso.Outdoor.Domain` so both apps share it. |
| data-access | New specialist | claude-sonnet-5.5 | Own `src/Contoso.Outdoor.Data` (EF6) and its EF Core 10 port in `src/Contoso.Outdoor.Data.Core`: mappings to the existing SQL Server schema, queries and transactions shared by both apps until cutover. |
| cloud-platform | New specialist | gpt-6.1-sol | Own containerisation and Azure delivery for the new host: `src/Contoso.Outdoor.Web.Core/Dockerfile`, Bicep under `infra/`, `azure.yaml`, Container Apps, Azure SQL, Key Vault, managed identity and the GitHub Actions deploy workflow. |
| migration-reviewer | New specialist | gpt-6.1-sol | Review each feature PR for behavior parity with the legacy app, shared-schema safety and Azure security before it merges. |

Concurrency: 2 active sessions. This is not a limit on team size.
PR reviewer: crewbie-migration-reviewer reviews each feature PR before you merge it into the default branch.

Model profile: **balanced**. Explicit model overrides remain authoritative.
Crewbie launch limits: **20 per batch / 3 per task**, including the first attempt and uncertain requests. No feature token ceiling (set `execution.maxTokensPerFeature` to add one). Not a monetary cap.

### web-migration

**Working knowledge**
- `src/Contoso.Outdoor.Web/App_Start/RouteConfig.cs` defines the public routes (for example `p/{slug}`); ported routes must keep the same templates.
- `src/Contoso.Outdoor.Web/Global.asax.cs` registers filters, routes and bundles; ASP.NET Core replaces them with middleware, endpoint routing and static web assets.
- `src/Contoso.Outdoor.Web/App_Start/Startup.Auth.cs` issues the `.Outdoor.Auth` cookie through OWIN; System.Web adapters remote app authentication lets the new host trust it during migration.
- Sessions are InProc in `src/Contoso.Outdoor.Web/Web.config`; the cart lives there, so the new host reads it through the adapters' remote session.
- `src/Contoso.Outdoor.Domain` is .NET Framework only; multi-target it (net48;net10.0) as SDK-style first so both apps share pricing.

**Checks**
- `dotnet build` and `dotnet test` pass for the new projects; `tests/Contoso.Outdoor.Tests` still passes in the Windows CI job.
- Each ported route returns the same status code, URL, redirects and visible content as the legacy route.

**Model proposal (complex):** Porting routes while sharing session and auth with a live legacy app needs reasoning across two frameworks; parity mistakes reach shoppers.

**Boundaries**
- Never change a public URL, query string or cookie name.
- One legacy controller per task; unported routes stay forwarded by YARP.

### data-access

**Working knowledge**
- `src/Contoso.Outdoor.Data/OutdoorContext.cs` is EF6 code-first; `src/Contoso.Outdoor.Data/Migrations/Configuration.cs` disables automatic migrations, and the database is authoritative.
- EF6 conventions differ from EF Core (pluralised table names, cascade deletes, decimal precision); map tables, keys and `HasPrecision(18, 2)` explicitly.
- Azure SQL uses `Authentication=Active Directory Default` with the app's managed identity; local development uses the developer's Entra sign-in.

**Checks**
- Integration tests run the EF Core context against SQL Server in a container and compare query results with the EF6 context for the same data.
- No EF Core or EF6 migration is added before cutover.

**Model proposal (standard):** Mapping a known schema is well-specified work; the traps are documented in this role's knowledge.

**Boundaries**
- No schema change the legacy EF6 app cannot read.
- No connection string with a password in any committed file.

### cloud-platform

**Working knowledge**
- `.github/workflows/build.yml` builds the legacy solution on windows-latest; the new host gets its own ubuntu job so neither blocks the other.
- ASP.NET Core containers listen on 8080 by default since .NET 8; Container Apps ingress targets that port and terminates TLS.
- azd reads `azure.yaml`: `azd provision` deploys `infra/main.bicep`, `azd deploy` builds the image, pushes it to Azure Container Registry and updates the container app.

**Checks**
- `az bicep build --file infra/main.bicep` succeeds and `azd provision --preview` shows only intended changes.
- `docker build` of the new host succeeds and the container answers its health endpoint.

**Model proposal (standard):** Infrastructure as code follows documented patterns; a strong general model with current Azure knowledge is enough, with Microsoft Learn MCP for specifics.

**Boundaries**
- No secrets in Bicep parameters, workflows or appsettings.
- GitHub Actions authenticate to Azure with OIDC federated credentials, never stored client secrets.

### migration-reviewer

**Working knowledge**
- The legacy original of every ported controller is in `src/Contoso.Outdoor.Web/Controllers`; compare actions, attributes and views side by side.

**Checks**
- Ported actions keep routes, status codes, validation and anti-forgery attributes; the YARP catch-all still forwards every unported route.
- The Windows legacy build and the new .NET 10 build both pass.

**Model proposal (standard):** A different model family from the main implementer gives an independent second opinion at moderate cost.

**Boundaries**
- Block a PR that changes a public URL, cookie or the shared schema without a recorded decision in `docs/destination.md`.

## Proposed guidance edits

5 concrete edits. These are applied only when guidance changes are approved.

### .github/copilot-instructions.md

Replace legacy-only rules that contradict the migration; keep it to commands and repository-wide invariants.

```markdown
# Contoso Outdoor store

Online store being migrated route by route from ASP.NET MVC 5 on .NET Framework 4.8 (`src/Contoso.Outdoor.Web`) to ASP.NET Core on .NET 10 (`src/Contoso.Outdoor.Web.Core`) on Azure Container Apps. Project context and open decisions: `docs/destination.md`.

## Commands

- Legacy app (Windows only): `nuget restore Contoso.Outdoor.sln`, then `msbuild Contoso.Outdoor.sln /p:Configuration=Release`; CI runs this in `.github/workflows/build.yml`.
- New projects (any OS): `dotnet build src/Contoso.Outdoor.Web.Core` and `dotnet test tests/Contoso.Outdoor.Web.Core.Tests`.
- Local run: `dotnet run --project src/Contoso.Outdoor.Web.Core`; unmigrated routes forward to the legacy app at `Legacy:BaseUrl`.

## Rules

- Public URLs, query strings and the `.Outdoor.Auth` cookie name never change; search engines and saved carts depend on them.
- Both apps share the SQL Server schema until cutover: no schema change the EF6 app cannot read.
- Prices round with `MidpointRounding.AwayFromZero` to 2 decimals (`src/Contoso.Outdoor.Domain/Pricing/PriceCalculator.cs`); keep it.
- Configuration comes from appsettings.json and environment variables; secrets come from Key Vault through managed identity, never from committed files.

```

### .github/instructions/legacy-web.instructions.md

Freeze rules for the legacy app, loaded only when it is edited.

```markdown
---
applyTo: "src/Contoso.Outdoor.Web/**"
---
# Legacy MVC 5 app (frozen)

- This app is retired route by route. Change it only to keep an unmigrated route working or to share session and auth with the new host.
- It builds only on Windows with MSBuild and packages.config; do not convert it to SDK-style or PackageReference.
- When a route moves to `src/Contoso.Outdoor.Web.Core`, leave the legacy controller in place until cutover; YARP stops forwarding it instead.

```

### .github/instructions/aspnetcore.instructions.md

Porting rules for the new host.

```markdown
---
applyTo: "src/Contoso.Outdoor.Web.Core/**"
---
# ASP.NET Core host (.NET 10)

- Port one legacy controller and its views per change. Keep action names, route templates (`App_Start/RouteConfig.cs`), model binding and validation identical.
- Replace globals with DI: `HandleErrorAttribute` becomes the exception handler middleware, `RequireHttpsAttribute` becomes HTTPS redirection, bundles become static web assets.
- Keep `[ValidateAntiForgeryToken]` on every POST the legacy action had.
- Session and auth come from the legacy app through System.Web adapters (remote app); read `Session` through the adapter, never a second store.
- The YARP catch-all route stays last so every unmigrated path still reaches the legacy app.

```

### .github/instructions/data.instructions.md

Shared-schema rules for both data projects.

```markdown
---
applyTo: "src/Contoso.Outdoor.Data/**,src/Contoso.Outdoor.Data.Core/**"
---
# Data access

- The database schema is authoritative. EF Core maps it explicitly (table, column and key names, `HasPrecision(18, 2)` for money); do not add EF Core migrations before cutover.
- EF6 lazy-loads navigation properties; EF Core does not. Ported queries use `Include` or projections so results match.
- Do not add EF6 migrations either: the schema is frozen while both apps read it.

```

### .github/instructions/infra.instructions.md

Azure and container rules for infrastructure files.

```markdown
---
applyTo: "infra/**,azure.yaml,src/Contoso.Outdoor.Web.Core/Dockerfile"
---
# Azure infrastructure

- Bicep under `infra/`, deployed with azd. Parameters never contain secrets; use managed identity role assignments and Key Vault references.
- The container uses `mcr.microsoft.com/dotnet/aspnet:10.0` and listens on port 8080; Container Apps ingress terminates TLS.
- Assign least-privilege roles to the app's managed identity at resource scope.

```

### Proposed constitution

```markdown
# Contoso Outdoor constitution

1. Shoppers never notice the migration. Same URLs, cookies, prices and checkout steps before, during and after every change.
2. Small, reversible steps. One route or one component per change, with the legacy path still available behind YARP.
3. The shared database is a contract. Neither app may change it in a way the other cannot read until cutover is decided.
4. No secrets in the repository. Identity-based access only.

```

### .github/workflows/copilot-setup-steps.yml

Runs before each Copilot cloud agent session so agents start with dependencies installed. Created only when absent; applied with the guidance choice.

```yaml
name: Copilot setup steps
on:
  workflow_dispatch:
  push:
    paths: [.github/workflows/copilot-setup-steps.yml]
  pull_request:
    paths: [.github/workflows/copilot-setup-steps.yml]
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
```

## Proposed MCP servers

Applied with the guidance choice. Crewbie creates the local file only when it does not exist; never store secret values in it.

- **microsoft-learn** (http, also cloud agent): Current ASP.NET Core, YARP, System.Web adapters, EF Core and Azure documentation and code samples.
- **azure** (local): Inspect the team's Container Apps, Azure SQL and Key Vault resources while developing locally (uses your az login).

### .vscode/mcp.json

```json
{
  "servers": {
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp"
    },
    "azure": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@azure/mcp@4.0.0-beta.3",
        "server",
        "start"
      ]
    }
  }
}
```

### Copilot cloud agent

Paste into contoso/outdoor-store Settings > Copilot > MCP servers (GitHub and Playwright are already enabled there).

```json
{
  "mcpServers": {
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp",
      "tools": [
        "*"
      ]
    }
  }
}
```

## Hosted planning

Enabled with model `claude-opus-5.5`. The ready-for-planning label authorizes a potentially billable planning run. Execution after a human merges the planning PR: **enabled (the merge approves paid work on the exact plan)**.

## Assessment findings and recommendations

Recommendations are not automatically applied. Only the concrete guidance edits above are proposed writes.

### instructions - .github/copilot-instructions.md

Describes the legacy app as the target: EF6 migrations for every change, Web Deploy to IIS and Web.config settings. That contradicts the migration and would push agents to change the frozen schema. The 'clean code' line adds nothing.

**Recommendation:** Rewrite it for the migration and move framework-specific rules into path-scoped files.

**Disposition:** edit

### instructions

No path-scoped guidance; legacy and new code need opposite rules (frozen versus actively ported).

**Recommendation:** Add scoped instructions for the legacy app, the new host, data access and infrastructure.

**Disposition:** edit

### mcp

No MCP servers. The migration relies on current ASP.NET Core, YARP, EF Core and Azure documentation.

**Recommendation:** Add Microsoft Learn (also for the cloud agent) and the Azure MCP server for local work against the team's subscription.

**Disposition:** edit

### agents

No custom agents exist.

**Recommendation:** Create the Crewbie specialists below.

**Disposition:** retain

### constitution

No constitution. The destination states non-negotiable migration principles that every role must respect.

**Recommendation:** Add a short constitution with the migration principles.

**Disposition:** edit

## Coverage

AI guidance (agent instructions, custom agents, constitution and MCP metadata, bounded to 256 KB of text) plus redacted build evidence: manifest summaries (scripts, dependencies, engines), non-Crewbie CI workflow text and root file names. Application source, READMEs and other project files are not read; only their names are mapped (directories and workspaces) to check cited paths. Ignored files and personal/global MCP settings are not read. MCP configurations are inspected, never launched; arguments, URLs, headers and credential values are withheld. Builds and server availability are unverified.


## Reviewed installation files

- Create .crewbie/config.json [User policy] - Team, explicit models, approvals and limits; update preserves your configuration.
- Create .crewbie/instructions.md [Crewbie-managed] - Single shared working policy referenced by specialists, not duplicated into each charter.
- Create .github/skills/crewbie/SKILL.md [Crewbie-managed] - Discover the local implementation workflow on demand instead of always loading it.
- Create .github/workflows/crewbie-plan.yml [Crewbie-managed] - Prepare a coordinator plan from approved issue intake; the planning opt-in gate still applies. Human-edited workflows block update.
- Create .github/workflows/crewbie-execute-plan.yml [Crewbie-managed] - Treat a write-access human's merge as execution approval after verifying the exact plan, source and policy before publishing implementation tasks. Human-edited workflows block update.
- Create .github/workflows/crewbie-dispatch.yml [Crewbie-managed] - Release approved tasks when dependencies, capacity and launch controls permit; merge each finished task PR into its plan's feature branch once checks pass, then open the feature PR to the default branch and request its review. Human-edited workflows block update.
- Create .github/workflows/crewbie-review.yml [Crewbie-managed] - Have the configured Crewbie reviewer comment on each task and feature PR head; reads the API diff and never runs PR code. Human-edited workflows block update.
- Create .github/workflows/crewbie-fix.yml [Crewbie-managed] - Run the named Crewbie operation with bounded permissions. Human-edited workflows block update.
- Create .github/workflows/crewbie-maintain.yml [Crewbie-managed] - Offer bounded knowledge-maintenance proposals; scheduled analysis remains opt-in. Human-edited workflows block update.
- Create .github/workflows/crewbie-report.yml [Crewbie-managed] - Collect execution evidence into a static report without starting implementation agents. Human-edited workflows block update.
- Create .crewbie/constitution.md [User guidance] - Keep approved principles or shared decisions; reuse existing documents.
- Create .vscode/mcp.json [Reviewed MCP configuration] - Proposed local MCP servers; secrets are prompted when a server starts and never written. Created only when absent.
- Create .github/workflows/copilot-setup-steps.yml [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create docs/destination.md [User knowledge] - Purpose, users, constraints, decisions, open questions and scope charted in the setup interview; agents read it for project context. Created when absent; replaced only when revisited in init.
- Update .github/copilot-instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/legacy-web.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/aspnetcore.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/data.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/infra.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/agents/crewbie-web-migration.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/web-migration/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/web-migration/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-data-access.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/data-access/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/data-access/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-cloud-platform.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/cloud-platform/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/cloud-platform/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-migration-reviewer.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/migration-reviewer/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/migration-reviewer/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-coordinator.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/coordinator/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/coordinator/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-improver.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/improver/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/improver/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .crewbie/decisions/hot.md [User guidance] - Keep approved principles or shared decisions; reuse existing documents.
- Create .crewbie/decisions/index.md [User guidance] - Seed shared-decision topic pointers; existing knowledge is never regenerated.
- Create .github/PULL_REQUEST_TEMPLATE.md [Crewbie-managed] - Prompt for concise implementation evidence, handoffs and learning.

## Installation choice

Team plus the concrete guidance edits listed above.
