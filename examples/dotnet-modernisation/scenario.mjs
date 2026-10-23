// Scenario: a legacy ASP.NET MVC 5 / .NET Framework 4.8 store migrating to ASP.NET Core on .NET 10 in Azure Container Apps.
// `files` is the repository before init, `destination` the Crewbie Compass map, and `review` the JSON Copilot returned.
const csproj = (name, references = "") => `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <RootNamespace>${name}</RootNamespace>
    <TargetFrameworkVersion>v4.8</TargetFrameworkVersion>
  </PropertyGroup>
  <ItemGroup>${references}
  </ItemGroup>
</Project>
`;

const files = {
  "README.md": "# Contoso Outdoor store\n\nOnline store for Contoso Outdoor: catalog, cart, checkout and customer accounts.\n\nBuild with Visual Studio 2022 or `msbuild Contoso.Outdoor.sln`. Deployed to IIS with Web Deploy.\n",
  "Contoso.Outdoor.sln": "Microsoft Visual Studio Solution File, Format Version 12.00\n# Visual Studio Version 17\n",
  "src/Contoso.Outdoor.Web/Contoso.Outdoor.Web.csproj": csproj("Contoso.Outdoor.Web", `
    <Reference Include="System.Web.Mvc, Version=5.2.9.0" />
    <Reference Include="EntityFramework, Version=6.0.0.0" />
    <Content Include="Global.asax" />
    <Content Include="Web.config" />`),
  "src/Contoso.Outdoor.Web/packages.config": `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Microsoft.AspNet.Mvc" version="5.2.9" targetFramework="net48" />
  <package id="Microsoft.AspNet.Identity.Owin" version="2.2.4" targetFramework="net48" />
  <package id="EntityFramework" version="6.4.4" targetFramework="net48" />
  <package id="Newtonsoft.Json" version="13.0.3" targetFramework="net48" />
</packages>
`,
  "src/Contoso.Outdoor.Web/Global.asax": "<%@ Application Codebehind=\"Global.asax.cs\" Inherits=\"Contoso.Outdoor.Web.MvcApplication\" Language=\"C#\" %>\n",
  "src/Contoso.Outdoor.Web/Global.asax.cs": "namespace Contoso.Outdoor.Web\n{\n    public class MvcApplication : System.Web.HttpApplication\n    {\n        protected void Application_Start()\n        {\n            AreaRegistration.RegisterAllAreas();\n            FilterConfig.RegisterGlobalFilters(GlobalFilters.Filters);\n            RouteConfig.RegisterRoutes(RouteTable.Routes);\n            BundleConfig.RegisterBundles(BundleTable.Bundles);\n        }\n    }\n}\n",
  "src/Contoso.Outdoor.Web/Web.config": "<?xml version=\"1.0\"?>\n<configuration>\n  <connectionStrings>\n    <add name=\"OutdoorContext\" connectionString=\"Server=CONTOSO-SQL01;Database=Outdoor;Integrated Security=true\" providerName=\"System.Data.SqlClient\" />\n  </connectionStrings>\n  <system.web>\n    <authentication mode=\"None\" />\n    <sessionState mode=\"InProc\" timeout=\"30\" />\n  </system.web>\n</configuration>\n",
  "src/Contoso.Outdoor.Web/App_Start/RouteConfig.cs": "public class RouteConfig\n{\n    public static void RegisterRoutes(RouteCollection routes)\n    {\n        routes.MapRoute(\"Product\", \"p/{slug}\", new { controller = \"Catalog\", action = \"Product\" });\n        routes.MapRoute(\"Default\", \"{controller}/{action}/{id}\", new { controller = \"Catalog\", action = \"Index\", id = UrlParameter.Optional });\n    }\n}\n",
  "src/Contoso.Outdoor.Web/App_Start/FilterConfig.cs": "public class FilterConfig\n{\n    public static void RegisterGlobalFilters(GlobalFilterCollection filters)\n    {\n        filters.Add(new HandleErrorAttribute());\n        filters.Add(new RequireHttpsAttribute());\n    }\n}\n",
  "src/Contoso.Outdoor.Web/App_Start/Startup.Auth.cs": "public partial class Startup\n{\n    public void ConfigureAuth(IAppBuilder app)\n    {\n        app.UseCookieAuthentication(new CookieAuthenticationOptions { CookieName = \".Outdoor.Auth\", LoginPath = new PathString(\"/Account/Login\") });\n    }\n}\n",
  "src/Contoso.Outdoor.Web/Controllers/CatalogController.cs": "public class CatalogController : Controller\n{\n    private readonly OutdoorContext db = new OutdoorContext();\n\n    public ActionResult Index(string category, int page = 1) => View(db.Products.Where(p => p.Category == category).OrderBy(p => p.Name).Skip((page - 1) * 24).Take(24).ToList());\n\n    public ActionResult Product(string slug) => View(db.Products.Single(p => p.Slug == slug));\n}\n",
  "src/Contoso.Outdoor.Web/Controllers/CartController.cs": "public class CartController : Controller\n{\n    [HttpPost, ValidateAntiForgeryToken]\n    public ActionResult Add(int productId, int quantity) { Session[\"cart\"] = Cart.From(Session).Add(productId, quantity); return RedirectToAction(\"Index\"); }\n}\n",
  "src/Contoso.Outdoor.Web/Controllers/AccountController.cs": "[Authorize]\npublic class AccountController : Controller\n{\n    [AllowAnonymous]\n    public ActionResult Login(string returnUrl) => View();\n}\n",
  "src/Contoso.Outdoor.Web/Views/Catalog/Index.cshtml": "@model IEnumerable<Contoso.Outdoor.Domain.Product>\n<h1>@ViewBag.Category</h1>\n",
  "src/Contoso.Outdoor.Web/Views/Catalog/Product.cshtml": "@model Contoso.Outdoor.Domain.Product\n<h1>@Model.Name</h1>\n",
  "src/Contoso.Outdoor.Web/Views/Shared/_Layout.cshtml": "<!DOCTYPE html>\n<html><head><title>@ViewBag.Title - Contoso Outdoor</title>@Styles.Render(\"~/Content/css\")</head><body>@RenderBody()</body></html>\n",
  "src/Contoso.Outdoor.Data/Contoso.Outdoor.Data.csproj": csproj("Contoso.Outdoor.Data", "\n    <Reference Include=\"EntityFramework, Version=6.0.0.0\" />"),
  "src/Contoso.Outdoor.Data/OutdoorContext.cs": "public class OutdoorContext : DbContext\n{\n    public OutdoorContext() : base(\"name=OutdoorContext\") { }\n    public DbSet<Product> Products { get; set; }\n    public DbSet<Order> Orders { get; set; }\n}\n",
  "src/Contoso.Outdoor.Data/Migrations/Configuration.cs": "internal sealed class Configuration : DbMigrationsConfiguration<OutdoorContext>\n{\n    public Configuration() { AutomaticMigrationsEnabled = false; }\n}\n",
  "src/Contoso.Outdoor.Domain/Contoso.Outdoor.Domain.csproj": csproj("Contoso.Outdoor.Domain"),
  "src/Contoso.Outdoor.Domain/Product.cs": "public class Product\n{\n    public int Id { get; set; }\n    public string Slug { get; set; }\n    public string Name { get; set; }\n    public string Category { get; set; }\n    public decimal Price { get; set; }\n}\n",
  "src/Contoso.Outdoor.Domain/Pricing/PriceCalculator.cs": "public static class PriceCalculator\n{\n    public static decimal Total(IEnumerable<CartLine> lines, decimal vatRate) => Math.Round(lines.Sum(l => l.Price * l.Quantity) * (1 + vatRate), 2, MidpointRounding.AwayFromZero);\n}\n",
  "tests/Contoso.Outdoor.Tests/Contoso.Outdoor.Tests.csproj": csproj("Contoso.Outdoor.Tests", "\n    <Reference Include=\"Microsoft.VisualStudio.TestPlatform.TestFramework\" />"),
  "tests/Contoso.Outdoor.Tests/PriceCalculatorTests.cs": "[TestClass]\npublic class PriceCalculatorTests\n{\n    [TestMethod]\n    public void RoundsVatAwayFromZero() => Assert.AreEqual(12.11m, PriceCalculator.Total(new[] { new CartLine(10.005m, 1) }, 0.21m));\n}\n",
  ".github/workflows/build.yml": `name: build
on: [push, pull_request]
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: microsoft/setup-msbuild@v2
      - uses: NuGet/setup-nuget@v2
      - run: nuget restore Contoso.Outdoor.sln
      - run: msbuild Contoso.Outdoor.sln /p:Configuration=Release
      - run: vstest.console.exe tests\\Contoso.Outdoor.Tests\\bin\\Release\\Contoso.Outdoor.Tests.dll
`,
  ".github/copilot-instructions.md": "This is an ASP.NET MVC 5 application on .NET Framework 4.8.\n\n- Use Entity Framework 6 code-first and add a migration for every model change.\n- Deploy to IIS on CONTOSO-WEB01 with Web Deploy.\n- Store settings in Web.config appSettings.\n- Write clean code and follow best practices.\n",
};

const destination = {
  destination: "Contoso Outdoor's online store (catalog, cart, checkout and customer accounts for retail shoppers), moving from an ASP.NET MVC 5 / .NET Framework 4.8 monolith on on-premises IIS to ASP.NET Core on .NET 10 in Azure Container Apps without a big-bang cutover.",
  notes: [
    "Shoppers must not notice the migration: URLs, cookies, sessions and checkout behavior stay the same during and after it.",
    "Migrate incrementally (strangler fig): a new ASP.NET Core host serves migrated routes and forwards the rest to the legacy app with YARP.",
    "The legacy app keeps running on IIS until every route is migrated; both apps share the SQL Server database until cutover.",
  ],
  decisions: [
    { topic: "Target framework", decision: ".NET 10 (LTS) with ASP.NET Core MVC and Razor views (recommended default)." },
    { topic: "Incremental migration", decision: "YARP fallback plus System.Web adapters to share session and authentication with the legacy app." },
    { topic: "Hosting", decision: "Azure Container Apps (Linux containers) behind Azure Front Door; Azure SQL Database after the data move." },
    { topic: "Data access", decision: "EF Core 10 mapped to the existing schema; no EF Core migrations until cutover (recommended default)." },
    { topic: "Secrets and identity", decision: "Managed identity for Azure SQL and Key Vault; no passwords in configuration." },
    { topic: "Infrastructure", decision: "Bicep deployed with azd; GitHub Actions deploy with OIDC federated credentials." },
    { topic: "Observability", decision: "OpenTelemetry to Application Insights (assumed)." },
  ],
  notYetSpecified: ["Cutover date for the legacy IIS servers.", "Whether the back-office admin area migrates or is replaced."],
  outOfScope: ["Rewriting the UI as a single-page app.", "Changing the catalog data model.", "Splitting the store into microservices."],
};

const global = `# Contoso Outdoor store

Online store being migrated route by route from ASP.NET MVC 5 on .NET Framework 4.8 (\`src/Contoso.Outdoor.Web\`) to ASP.NET Core on .NET 10 (\`src/Contoso.Outdoor.Web.Core\`) on Azure Container Apps. Project context and open decisions: \`docs/destination.md\`.

## Commands

- Legacy app (Windows only): \`nuget restore Contoso.Outdoor.sln\`, then \`msbuild Contoso.Outdoor.sln /p:Configuration=Release\`; CI runs this in \`.github/workflows/build.yml\`.
- New projects (any OS): \`dotnet build src/Contoso.Outdoor.Web.Core\` and \`dotnet test tests/Contoso.Outdoor.Web.Core.Tests\`.
- Local run: \`dotnet run --project src/Contoso.Outdoor.Web.Core\`; unmigrated routes forward to the legacy app at \`Legacy:BaseUrl\`.

## Rules

- Public URLs, query strings and the \`.Outdoor.Auth\` cookie name never change; search engines and saved carts depend on them.
- Both apps share the SQL Server schema until cutover: no schema change the EF6 app cannot read.
- Prices round with \`MidpointRounding.AwayFromZero\` to 2 decimals (\`src/Contoso.Outdoor.Domain/Pricing/PriceCalculator.cs\`); keep it.
- Configuration comes from appsettings.json and environment variables; secrets come from Key Vault through managed identity, never from committed files.
`;

const legacy = `---
applyTo: "src/Contoso.Outdoor.Web/**"
---
# Legacy MVC 5 app (frozen)

- This app is retired route by route. Change it only to keep an unmigrated route working or to share session and auth with the new host.
- It builds only on Windows with MSBuild and packages.config; do not convert it to SDK-style or PackageReference.
- When a route moves to \`src/Contoso.Outdoor.Web.Core\`, leave the legacy controller in place until cutover; YARP stops forwarding it instead.
`;

const core = `---
applyTo: "src/Contoso.Outdoor.Web.Core/**"
---
# ASP.NET Core host (.NET 10)

- Port one legacy controller and its views per change. Keep action names, route templates (\`App_Start/RouteConfig.cs\`), model binding and validation identical.
- Replace globals with DI: \`HandleErrorAttribute\` becomes the exception handler middleware, \`RequireHttpsAttribute\` becomes HTTPS redirection, bundles become static web assets.
- Keep \`[ValidateAntiForgeryToken]\` on every POST the legacy action had.
- Session and auth come from the legacy app through System.Web adapters (remote app); read \`Session\` through the adapter, never a second store.
- The YARP catch-all route stays last so every unmigrated path still reaches the legacy app.
`;

const data = `---
applyTo: "src/Contoso.Outdoor.Data/**,src/Contoso.Outdoor.Data.Core/**"
---
# Data access

- The database schema is authoritative. EF Core maps it explicitly (table, column and key names, \`HasPrecision(18, 2)\` for money); do not add EF Core migrations before cutover.
- EF6 lazy-loads navigation properties; EF Core does not. Ported queries use \`Include\` or projections so results match.
- Do not add EF6 migrations either: the schema is frozen while both apps read it.
`;

const infra = `---
applyTo: "infra/**,azure.yaml,src/Contoso.Outdoor.Web.Core/Dockerfile"
---
# Azure infrastructure

- Bicep under \`infra/\`, deployed with azd. Parameters never contain secrets; use managed identity role assignments and Key Vault references.
- The container uses \`mcr.microsoft.com/dotnet/aspnet:10.0\` and listens on port 8080; Container Apps ingress terminates TLS.
- Assign least-privilege roles to the app's managed identity at resource scope.
`;

const constitution = `# Contoso Outdoor constitution

1. Shoppers never notice the migration. Same URLs, cookies, prices and checkout steps before, during and after every change.
2. Small, reversible steps. One route or one component per change, with the legacy path still available behind YARP.
3. The shared database is a contract. Neither app may change it in a way the other cannot read until cutover is decided.
4. No secrets in the repository. Identity-based access only.
`;

const finding = (area, path, assessment, recommendation, action, editPaths) => ({ area, path, assessment, recommendation, action, ...(editPaths ? { editPaths } : {}) });

export default {
  repository: "contoso/outdoor-store",
  start: "dotnet run --project src/Contoso.Outdoor.Web.Core",
  files,
  destination,
  issue: {
    number: 12, updatedAt: "2026-03-02T09:14:00Z",
    title: "Serve the catalog from the .NET 10 host on Azure Container Apps",
    body: "First slice of the modernisation: the catalog and product pages (`/catalog`, `/p/{slug}`) are served by a new ASP.NET Core host on Azure Container Apps. Every other route keeps working through the legacy app.\n\n- Shoppers see no difference: same URLs, same prices, same sign-in.\n- The legacy app keeps running and keeps its Windows build.\n- Deployed with azd; no secrets in the repository.\n",
  },
  plan: {
    summary: "Five tasks in dependency order. The shared domain is multi-targeted first, the new host starts as a YARP proxy in front of the legacy app, EF Core maps the existing schema, the container and Azure infrastructure follow the host, and the catalog routes are ported last, when host and data are in place.",
    tasks: [
      { id: "domain-multitarget", title: "Multi-target the domain library", owner: "web-migration", priority: 1, dependsOn: [],
        scope: "Convert `src/Contoso.Outdoor.Domain` to an SDK-style project targeting net48 and net10.0 so the legacy and new hosts share PriceCalculator.",
        acceptanceCriteria: ["The legacy solution still builds and its tests pass on Windows.", "The domain library builds for net10.0 on Linux.", "No pricing behavior changes."] },
      { id: "core-host-yarp", title: "Create the ASP.NET Core host with YARP fallback", owner: "web-migration", priority: 2, dependsOn: [],
        scope: "Add `src/Contoso.Outdoor.Web.Core` (.NET 10) with System.Web adapters and a YARP catch-all that forwards every route to the legacy app, sharing its `.Outdoor.Auth` cookie and session.",
        acceptanceCriteria: ["Every legacy route answers through the new host with the same status and content.", "A signed-in shopper stays signed in across both apps.", "A health endpoint returns 200."] },
      { id: "efcore-context", title: "Map the catalog schema with EF Core 10", owner: "data-access", priority: 2, dependsOn: [],
        scope: "Add `src/Contoso.Outdoor.Data.Core` with an EF Core 10 context for products and categories, mapped explicitly to the existing tables.",
        acceptanceCriteria: ["Integration tests return the same products and prices as the EF6 context for the same data.", "No migration is added.", "Connections use managed identity in Azure."] },
      { id: "container-infra", title: "Containerise and provision the new host", owner: "cloud-platform", priority: 3, dependsOn: ["core-host-yarp"],
        scope: "Add the Dockerfile, `azure.yaml` and Bicep for Container Apps, Container Registry, Key Vault and managed identity, plus a deploy workflow using OIDC.",
        acceptanceCriteria: ["`azd provision --preview` shows only the intended resources.", "The image builds and answers its health endpoint.", "No secret is committed or stored as a workflow secret for Azure sign-in."] },
      { id: "catalog-routes", title: "Port the catalog and product routes", owner: "web-migration", priority: 4, dependsOn: ["core-host-yarp", "efcore-context", "domain-multitarget"],
        scope: "Port CatalogController and ProductController with their views to the new host; YARP stops forwarding exactly these routes.",
        acceptanceCriteria: ["`/catalog` and `/p/{slug}` return the same URLs, status codes, prices and visible content as the legacy app.", "All other routes are still forwarded.", "Tests cover a found product, an unknown slug and a discounted price."] },
    ],
  },
  review: () => ({
    summary: "Brownfield .NET Framework 4.8 MVC 5 store with one outdated instruction file and no agents or MCP servers. The work is an incremental migration to ASP.NET Core on .NET 10 in Azure Container Apps, so the crew is split by what changes together during a strangler-fig migration: web routes and views, data access, and Azure platform, plus a reviewer focused on behavior parity.",
    findings: [
      finding("instructions", ".github/copilot-instructions.md", "Describes the legacy app as the target: EF6 migrations for every change, Web Deploy to IIS and Web.config settings. That contradicts the migration and would push agents to change the frozen schema. The 'clean code' line adds nothing.", "Rewrite it for the migration and move framework-specific rules into path-scoped files.", "edit", [".github/copilot-instructions.md"]),
      finding("instructions", null, "No path-scoped guidance; legacy and new code need opposite rules (frozen versus actively ported).", "Add scoped instructions for the legacy app, the new host, data access and infrastructure.", "edit", [".github/instructions/legacy-web.instructions.md", ".github/instructions/aspnetcore.instructions.md", ".github/instructions/data.instructions.md", ".github/instructions/infra.instructions.md"]),
      finding("mcp", null, "No MCP servers. The migration relies on current ASP.NET Core, YARP, EF Core and Azure documentation.", "Add Microsoft Learn (also for the cloud agent) and the Azure MCP server for local work against the team's subscription.", "edit"),
      finding("agents", null, "No custom agents exist.", "Create the Crewbie specialists below.", "retain"),
      finding("constitution", null, "No constitution. The destination states non-negotiable migration principles that every role must respect.", "Add a short constitution with the migration principles.", "edit"),
    ],
    questions: [],
    assumptions: [
      "The new host lives in `src/Contoso.Outdoor.Web.Core/` with tests in `tests/Contoso.Outdoor.Web.Core.Tests/`, and the EF Core port in `src/Contoso.Outdoor.Data.Core/`.",
      "Infrastructure is created under `infra/` with `azure.yaml` at the root, and the container definition is `src/Contoso.Outdoor.Web.Core/Dockerfile`.",
      "The legacy projects build only on Windows. Cloud agents run on Ubuntu, so they build and test the new .NET 10 projects, and the existing Windows job in .github/workflows/build.yml keeps verifying the legacy app.",
    ],
    roles: [
      {
        id: "web-migration", purpose: "Own the route-by-route port from `src/Contoso.Outdoor.Web` (MVC 5) to `src/Contoso.Outdoor.Web.Core` (ASP.NET Core, .NET 10): controllers, Razor views, filters, YARP forwarding and System.Web adapters, plus multi-targeting `src/Contoso.Outdoor.Domain` so both apps share it.",
        model: "claude-opus-5.5", complexity: "complex",
        modelReason: "Porting routes while sharing session and auth with a live legacy app needs reasoning across two frameworks; parity mistakes reach shoppers.",
        knowledge: [
          "`src/Contoso.Outdoor.Web/App_Start/RouteConfig.cs` defines the public routes (for example `p/{slug}`); ported routes must keep the same templates.",
          "`src/Contoso.Outdoor.Web/Global.asax.cs` registers filters, routes and bundles; ASP.NET Core replaces them with middleware, endpoint routing and static web assets.",
          "`src/Contoso.Outdoor.Web/App_Start/Startup.Auth.cs` issues the `.Outdoor.Auth` cookie through OWIN; System.Web adapters remote app authentication lets the new host trust it during migration.",
          "Sessions are InProc in `src/Contoso.Outdoor.Web/Web.config`; the cart lives there, so the new host reads it through the adapters' remote session.",
          "`src/Contoso.Outdoor.Domain` is .NET Framework only; multi-target it (net48;net10.0) as SDK-style first so both apps share pricing.",
        ],
        checks: [
          "`dotnet build` and `dotnet test` pass for the new projects; `tests/Contoso.Outdoor.Tests` still passes in the Windows CI job.",
          "Each ported route returns the same status code, URL, redirects and visible content as the legacy route.",
        ],
        nonNegotiables: [
          "Never change a public URL, query string or cookie name.",
          "One legacy controller per task; unported routes stay forwarded by YARP.",
        ],
        contextPaths: [],
      },
      {
        id: "data-access", purpose: "Own `src/Contoso.Outdoor.Data` (EF6) and its EF Core 10 port in `src/Contoso.Outdoor.Data.Core`: mappings to the existing SQL Server schema, queries and transactions shared by both apps until cutover.",
        model: "claude-sonnet-5.5", complexity: "standard",
        modelReason: "Mapping a known schema is well-specified work; the traps are documented in this role's knowledge.",
        knowledge: [
          "`src/Contoso.Outdoor.Data/OutdoorContext.cs` is EF6 code-first; `src/Contoso.Outdoor.Data/Migrations/Configuration.cs` disables automatic migrations, and the database is authoritative.",
          "EF6 conventions differ from EF Core (pluralised table names, cascade deletes, decimal precision); map tables, keys and `HasPrecision(18, 2)` explicitly.",
          "Azure SQL uses `Authentication=Active Directory Default` with the app's managed identity; local development uses the developer's Entra sign-in.",
        ],
        checks: [
          "Integration tests run the EF Core context against SQL Server in a container and compare query results with the EF6 context for the same data.",
          "No EF Core or EF6 migration is added before cutover.",
        ],
        nonNegotiables: ["No schema change the legacy EF6 app cannot read.", "No connection string with a password in any committed file."],
        contextPaths: [],
      },
      {
        id: "cloud-platform", purpose: "Own containerisation and Azure delivery for the new host: `src/Contoso.Outdoor.Web.Core/Dockerfile`, Bicep under `infra/`, `azure.yaml`, Container Apps, Azure SQL, Key Vault, managed identity and the GitHub Actions deploy workflow.",
        model: "gpt-6.1-sol", complexity: "standard",
        modelReason: "Infrastructure as code follows documented patterns; a strong general model with current Azure knowledge is enough, with Microsoft Learn MCP for specifics.",
        knowledge: [
          "`.github/workflows/build.yml` builds the legacy solution on windows-latest; the new host gets its own ubuntu job so neither blocks the other.",
          "ASP.NET Core containers listen on 8080 by default since .NET 8; Container Apps ingress targets that port and terminates TLS.",
          "azd reads `azure.yaml`: `azd provision` deploys `infra/main.bicep`, `azd deploy` builds the image, pushes it to Azure Container Registry and updates the container app.",
        ],
        checks: ["`az bicep build --file infra/main.bicep` succeeds and `azd provision --preview` shows only intended changes.", "`docker build` of the new host succeeds and the container answers its health endpoint."],
        nonNegotiables: ["No secrets in Bicep parameters, workflows or appsettings.", "GitHub Actions authenticate to Azure with OIDC federated credentials, never stored client secrets."],
        contextPaths: [],
      },
      {
        id: "migration-reviewer", purpose: "Review each feature PR for behavior parity with the legacy app, shared-schema safety and Azure security before it merges.",
        model: "gpt-6.1-sol", complexity: "standard",
        modelReason: "A different model family from the main implementer gives an independent second opinion at moderate cost.",
        knowledge: ["The legacy original of every ported controller is in `src/Contoso.Outdoor.Web/Controllers`; compare actions, attributes and views side by side."],
        checks: [
          "Ported actions keep routes, status codes, validation and anti-forgery attributes; the YARP catch-all still forwards every unported route.",
          "The Windows legacy build and the new .NET 10 build both pass.",
        ],
        nonNegotiables: ["Block a PR that changes a public URL, cookie or the shared schema without a recorded decision in `docs/destination.md`."],
        contextPaths: [],
      },
    ],
    reviewer: "migration-reviewer",
    agentDecisions: [],
    instructions: [
      { path: ".github/copilot-instructions.md", content: global, reason: "Replace legacy-only rules that contradict the migration; keep it to commands and repository-wide invariants." },
      { path: ".github/instructions/legacy-web.instructions.md", content: legacy, reason: "Freeze rules for the legacy app, loaded only when it is edited." },
      { path: ".github/instructions/aspnetcore.instructions.md", content: core, reason: "Porting rules for the new host." },
      { path: ".github/instructions/data.instructions.md", content: data, reason: "Shared-schema rules for both data projects." },
      { path: ".github/instructions/infra.instructions.md", content: infra, reason: "Azure and container rules for infrastructure files." },
    ],
    constitutionText: constitution,
    setupSteps: `name: Copilot setup steps
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
`,
    mcpServers: [
      { name: "microsoft-learn", purpose: "Current ASP.NET Core, YARP, System.Web adapters, EF Core and Azure documentation and code samples.", type: "http", command: null, args: [], url: "https://learn.microsoft.com/api/mcp", env: [], bearerSecret: null, tools: ["*"], cloud: true },
      { name: "azure", purpose: "Inspect the team's Container Apps, Azure SQL and Key Vault resources while developing locally (uses your az login).", type: "local", command: "npx", args: ["-y", "@azure/mcp@4.0.0-beta.3", "server", "start"], url: null, env: [], bearerSecret: null, tools: ["*"], cloud: false },
    ],
  }),
};
