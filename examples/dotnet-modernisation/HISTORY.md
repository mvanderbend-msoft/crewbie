# History: contoso/outdoor-store with Crewbie

From `crewbie init` (2026-08-24) to today (2026-10-23). Issues and PRs share one GitHub counter; #1 to #10 predate Crewbie.
Owners are the Copilot custom agents `crewbie-<role>`. `project/` shows the repository as it is today on the in-progress
feature branch `crewbie/issue-47-58bc4c10`: `main` plus the merged task PRs #53, #54 and #55.

## Setup

- **2026-08-24, PR #11** `crewbie init`: installs the team from `setup/crewbie-setup.md` (`web-migration`, `data-access`,
  `cloud-platform`, reviewer `migration-reviewer`), the agents, instructions, `docs/destination.md` and empty memory.
  Merged the same day by the tech lead. The nightly improver is left off (`nightly.enabled: false`); the team runs
  `crewbie-maintain.yml` by hand when they want it.

## Plan 1: serve the catalog from the .NET 10 host (#12)

- **2026-08-25, issue #12** "Serve the catalog from the .NET 10 host on Azure Container Apps", labelled
  `crewbie:ready-for-planning`.
- **2026-08-25, plan PR #13** from `crewbie/plans/serve-the-catalog-from-the-net-10-host-on-azure-container-ap-issue-12-3f9a1c07d2e84b65`
  adds `.crewbie/plans/serve-the-catalog-from-the-net-10-host-on-azure-container-ap-issue-12/`. The first draft had a task
  "port ProductController". The tech lead commented `/crewbie revise there is no ProductController, /p/{slug} is
  CatalogController.Product; also don't assert a status code for health, the probe defines it` (08-26). The coordinator
  redrafted and noted in its memory: "The legacy app has no ProductController ... Plan route ports from
  `App_Start/RouteConfig.cs`". Merged 08-27. Task issues #14 to #18 created.
- **#19** (task #14 `domain-multitarget`, `crewbie-web-migration`, 08-27 to 08-28): converts `Contoso.Outdoor.Domain`
  (`Product`, `PriceCalculator`, `CartLine`) to an SDK-style project targeting `net48;net10.0`. The Windows build failed with
  NETSDK1004 because `nuget restore` ignores SDK-style projects; fixed in the same PR by switching `build.yml` to
  `msbuild -restore`. Memory: "The Windows build runs `msbuild -restore` ...".
- **#20** (task #15 `core-host-yarp`, `crewbie-web-migration`, 08-27 to 08-31): new `Contoso.Outdoor.Web.Core` host with a
  YARP catch-all and the System.Web adapters (remote session and remote authentication for `.Outdoor.Auth`).
  Memory: "Keep `Order = int.MaxValue` on the YARP catch-all ..." and "The legacy app needs `AddProxySupport` ...".
- **#21** (task #16 `efcore-context`, `crewbie-data-access`, 08-28 to 09-01): `Contoso.Outdoor.Data.Core` with an EF Core
  10 context over the shared schema, plus Testcontainers parity tests. The new column test failed twice: EF Core asked for
  `Product` instead of `Products`, and mapped money as `decimal(18,2)` where the schema has `decimal(19,4)`. Fixed in the
  same PR. Memory: "EF6 created pluralised tables ...", "Money columns are `decimal(19,4)` ...", "Do not reference the
  EF6 project ..." with the cold topic `team/data-access/cold/parity-tests.md`. Decision: "Money is `decimal(19,4)` end to
  end and is rounded only in `PriceCalculator` ...". The parity tests took 9 minutes on the first agent run, mostly
  pulling the SQL Server image.
- **2026-08-31, task #17** `container-infra` did not start (the cloud agent reported a capacity error). A human added
  `crewbie:restart` on 09-01, and it started.
- **#22** (task #17 `container-infra`, `crewbie-cloud-platform`, 09-01 to 09-03): Dockerfile, `infra/` Bicep for the
  Container Apps environment, registry, Key Vault and a user-assigned identity, `azure.yaml`, and `deploy.yml` with
  OIDC. Memory: user-assigned identity with AcrPull first, `AZURE_CLIENT_ID` for `Active Directory Default`, and the
  OIDC subject `repo:contoso/outdoor-store:environment:production`.
- **#23** (task #18 `catalog-routes`, `crewbie-web-migration`, 09-01 to 09-05): ports `CatalogController` `Index` and
  `Product` with Razor views, and integration tests against a stub legacy app. Decision: "Ported controllers stay in the
  legacy app until cutover ..." with the shared cold topic `decisions/cold/strangler-routing.md`.
- **2026-09-05, feature PR #24** `crewbie/issue-12-51678845` to `main`. `crewbie-migration-reviewer` (09-06) requested
  changes:
  1. Behind Container Apps ingress the HTTPS redirect was 307 and pointed at the internal host, because forwarded headers
     were not applied first; legacy sent 302.
  2. `/p/{slug}` for an unknown product returned 404 where legacy answered 500; no decision was recorded.
  3. The SQL access path (Entra sign-in to CONTOSO-SQL01 over the environment subnet) was not in `docs/destination.md`.
  Reviewer memory: "On any host change, check HTTPS redirection behind ingress ..." and "Compare error paths, not just
  happy paths ...".
- **2026-09-07, `/crewbie fix`** for finding 1. **Fix task PR #25** (`crewbie-web-migration`) adds `UseForwardedHeaders`
  and a 302 redirect; merged into the feature branch 09-08. Memory: "Container Apps terminates TLS ...". The tech lead
  recorded findings 2 and 3 in `docs/destination.md` on the feature branch. Re-review approved 09-09.
- **2026-09-10**: the tech lead merged #24. The catalog is served by the new host in production.
- **2026-09-11, PR #26** (human): updates `.github/copilot-instructions.md` (build and test commands for both stacks),
  `data.instructions.md` (money precision), `aspnetcore.instructions.md` (302 behind forwarded headers) and
  `copilot-setup-steps.yml` (pre-pull the SQL Server image). Merged the same day.

## Plan 2: port the cart (#27)

- **2026-09-14, issue #27** "Port the cart to the new host". **Plan PR #28** from
  `crewbie/plans/port-the-cart-to-the-new-host-issue-27-a41d9e2b7c6f0358`, merged 09-15 without changes. Task issues
  #29 to #31.
- **#32** (task #29 `cart-session`, `crewbie-web-migration`, 09-15 to 09-17): moves `Cart` and `Address` into the domain
  project, adds `SessionKeys`, and registers both keys with the JSON session serializer in both apps. The round-trip test
  failed because `Cart.Items` had a private setter and deserialized empty; fixed in the same PR. Memory: "Register every
  shared session key with `RegisterKey<T>` in both apps ...". Decision: "Types stored in the shared session ... live in
  `Contoso.Outdoor.Domain` and are keyed through `SessionKeys` ...".
- **#33** (task #30 `cart-pricing`, `crewbie-data-access`, 09-15 to 09-16): `CartPricing` on EF Core, skipping products
  deleted since they were added, as legacy did. Parity test added; no memory entry (nothing surprising).
- **#34** (task #31 `cart-routes`, `crewbie-web-migration`, 09-17 to 09-21): ports `CartController` `Index` and `Add`.
  It added a memory entry saying the tests cover anti-forgery; #36 later replaced it.
- **2026-09-21, feature PR #35** `crewbie/issue-27-07ffda7f`. Reviewer (09-22): `Add` lost `[ValidateAntiForgeryToken]`
  and every test still passed, because no test posted without a token. Reviewer memory: "Compare attributes action by
  action ...". **`/crewbie fix`** the same day.
- **Fix task PR #36** (`crewbie-web-migration`, 09-22 to 09-23): restores the attribute, adds a global
  `AutoValidateAntiforgeryTokenAttribute` and a test that posts without a token. It **replaced** the stale #34 entry with
  "Keep the global `AutoValidateAntiforgeryTokenAttribute` ...".
- On #35 the tech lead added the `SessionKeys` rule to `.github/copilot-instructions.md`, then merged it on **2026-09-25**.

## Plan 3: health checks, telemetry and safe rollout (#37)

- **2026-09-28, issue #37** "Health checks, telemetry and safe rollout for the new host". **Plan PR #38** from
  `crewbie/plans/health-checks-telemetry-and-safe-rollout-for-the-new-host-issue-37-c86e05f1a9b2d473`. The draft put a
  second container app in place as a "staging slot". The platform lead commented `/crewbie revise Container Apps has no
  slots; use a labelled revision in multiple-revision mode` (09-29). Coordinator memory: "Container Apps has no deployment
  slots ...". Merged 09-30. Task issues #39 to #41.
- **#42** (task #39 `health-telemetry`, `crewbie-web-migration`, 09-30 to 10-02): `/healthz/live` and `/healthz/ready`
  (database only), Azure Monitor OpenTelemetry. Decision: "`/healthz/live` checks nothing and `/healthz/ready` checks only
  the database ...".
- **#43** (task #40 `monitoring-infra`, `crewbie-cloud-platform`, 09-30 to 10-02): Log Analytics, workspace-based
  Application Insights, an action group, and probes in `infra/modules/app.bicep`.
- **#44** (task #41 `revision-rollout`, `crewbie-cloud-platform`, 10-02 to 10-06): multiple-revision mode, a `staging`
  label smoke test in `deploy.yml`, then a traffic switch, and a `rollback` input. The smoke test failed because the
  probes got a 302: they call port 8080 over plain HTTP. Fixed in the same PR by exempting `/healthz` from HTTPS
  redirection. Memory: "In multiple-revision mode, traffic that follows the latest revision moves ... at once". Because
  the redirect lives in web-migration's code, cloud-platform posted a `<!-- crewbie-memory-proposal -->` comment on #44
  suggesting a web-migration entry.
- **2026-10-06, feature PR #45** `crewbie/issue-37-7d86327d`. The reviewer approved (10-07) and noted for the future:
  "Readiness must not depend on the legacy app ...". The tech lead added a `/healthz/*` line to
  `aspnetcore.instructions.md` and merged on **2026-10-08**.
- **2026-10-09, improver PR #46**: the platform lead ran `crewbie-maintain.yml` by hand. `crewbie-improver` picked up the
  proposal from #44 and added to web-migration's hot memory: "`/healthz/*` must skip HTTPS redirection ...", with #46 as its source and #44 as the evidence.
  Merged the same day.

## Plan 4: port checkout, payment stays on legacy (#47), in progress

- **2026-10-13, issue #47** "Port checkout to the new host (payment stays on the legacy app)". The payment provider's new
  SDK is still in procurement, so the issue keeps `/Checkout/Pay` and `/Checkout/Confirm` in legacy; the decision went
  into `docs/destination.md`.
- **Plan PR #48** from
  `crewbie/plans/port-checkout-to-the-new-host-payment-stays-on-the-legacy-ap-issue-47-0e7b39d5f14a2c68`, merged 10-14.
  Task issues #49 to #52.
- **#53** (task #49 `order-mapping`, `crewbie-data-access`, 10-14 to 10-16): `Order` and `OrderLine` in the domain and
  `OrderWriter` in EF Core. The read-back test failed on `OrderId`: EF6 created `Order_Id`. A first fix wrapped the write
  in `BeginTransaction`, which threw under `EnableRetryOnFailure`; the final version uses one `SaveChanges`. Memory: the
  `Order_Id` entry and "With `EnableRetryOnFailure`, a `BeginTransaction` outside an execution strategy throws ...".
  Decision: "Payment stays in the legacy app ...; the new host saves the order as `PendingPayment` and redirects to
  `/Checkout/Pay/{id}`".
- **#54** (task #50 `checkout-review`, `crewbie-web-migration`, 10-14 to 10-20): ports the checkout address step
  (`CheckoutController.Index` GET and POST). Manual testing in the staging revision showed that the "Place order" form,
  rendered by the new host, failed legacy's anti-forgery check. The task keeps `PlaceOrder` forwarded and leaves the form
  to #52. Memory: "MVC 5 and ASP.NET Core anti-forgery tokens are not interchangeable ...".
- **#55** (task #51 `checkout-alerts`, `crewbie-cloud-platform`, 10-16 to 10-17): a scheduled query alert on failed
  checkout requests. Memory: "Forwarded requests also land in `AppRequests`, named after the YARP catch-all route ...".
- **#56** (task #52 `place-order-handoff`, `crewbie-web-migration`, opened 10-21): ports `PlaceOrder`, saves the order
  with `OrderWriter` and redirects to legacy `Pay`. On 10-22 `CheckoutTests` failed: the redirect used the internal
  legacy host. The agent pushed a fix on 10-23; checks are running.

## Where things stand (2026-10-23)

- In progress: #56, the last task of plan 4. When it merges, Crewbie opens the feature PR for
  `crewbie/issue-47-58bc4c10`. Until then `PlaceOrder` in `project/src/Contoso.Outdoor.Web.Core` does not exist, and the
  form in `Views/Checkout/Index.cshtml` still posts to the legacy action.
- Served by the new host in production: catalog (#24), cart (#35), health checks (#45).
- Still on the legacy app: account and sign-in (`AccountController`), payment and confirmation. The back-office admin area is not part of this repository and is still undecided.
- Next, per `docs/destination.md`: move the payment provider once its SDK is approved, port account and sign-in, the data
  move to Azure SQL, and then decide the cutover date for the IIS servers and whether the admin area migrates or is
  replaced (both still under "Not yet specified").
