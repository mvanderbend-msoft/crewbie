# Strangler routing

Which app serves a request, and how routes move. Agreed on #23 (2026-09-05) and kept up to date with each ported feature.

## How a request is routed

1. Azure Front Door sends every request for the store to the container app.
2. The new host (`src/Contoso.Outdoor.Web.Core`) matches its controller routes first.
3. Anything else falls through to the YARP catch-all (`Order = int.MaxValue`) and is forwarded to the legacy IIS app, with `X-Forwarded-*` headers so legacy redirects stay on the public host.
4. Both apps read the `.Outdoor.Auth` cookie and the legacy session through the System.Web adapters; the new host never owns a session of its own.

## Routes served by the new host today

| Route | Since |
| --- | --- |
| `/Catalog/Index` (category pages), `/p/{slug}` | #24 (2026-09-10) |
| `/Cart`, `/Cart/Add` | #35 (2026-09-25) |
| `/healthz/live`, `/healthz/ready` | #45 (2026-10-08) |
| `/Checkout` (address step; `PlaceOrder`, `Pay` and `Confirm` still forwarded) | on the issue #47 branch, not merged |

## Porting a route

- Port the GET page and every POST it targets in the same feature; the two apps' anti-forgery tokens are not interchangeable (#54).
- Leave the legacy controller in place with a comment naming the PR that ported it.
- Record any behaviour change in `docs/destination.md` before the feature PR merges.

## Rolling a route back

Remove the action (or controller) from the new host and deploy. The catch-all forwards the URL to legacy again, which still has the code. For a bad deployment rather than a bad route, run `deploy.yml` with `rollback` to move traffic to the previous revision.

## At cutover

Delete the legacy controllers, the catch-all and the remote app settings in one change, after the data move to Azure SQL.