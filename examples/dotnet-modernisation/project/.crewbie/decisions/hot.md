# Shared decisions

Active cross-role choices only, one or two lines each: the choice and its reason, then the PR or file link in a trailing HTML comment. Replace superseded entries; move older detail to cold/ and link it from index.md. Link existing ADRs rather than copying them.

- Ported controllers stay in the legacy app until cutover; rolling a route back means removing it from the new host, and the YARP catch-all serves it from legacy again. See [strangler routing](cold/strangler-routing.md). <!-- source: #23 2026-09-05 -->
- Money is `decimal(19,4)` end to end and is rounded only in `PriceCalculator`, so both apps show the same totals while they share the database. <!-- source: #21 2026-09-01 -->
- Types stored in the shared session (`Cart`, `Address`) live in `Contoso.Outdoor.Domain` and are keyed through `SessionKeys`, so both apps serialize the same JSON. <!-- source: #32 2026-09-17 -->
- `/healthz/live` checks nothing and `/healthz/ready` checks only the database; neither calls the legacy app. <!-- source: #42 2026-10-02 -->
- Payment stays in the legacy app until the provider's new SDK is approved; the new host saves the order as `PendingPayment` and redirects to `/Checkout/Pay/{id}`. See `docs/destination.md`. <!-- source: #53 2026-10-16 -->
