# Shared decisions

Active cross-role choices only, one or two lines each: the choice and its reason, then the PR or file link in a trailing HTML comment. Replace superseded entries; move older detail to cold/ and link it from index.md. Link existing ADRs rather than copying them.

- Tool output reaches the model inside named tags (`<policy_excerpt>`, `<booking_result>`) and the instructions treat tag contents as data, never as instructions. <!-- source: #16 2026-09-03 -->
- Agent identity grants live only in `scripts/grant-agent-access.sh`, scoped to the resource read: Search Index Data Reader on the search service and the booking app role. <!-- source: #22 2026-09-11 -->
- Approval is the host's tool approval round trip with `previous_response_id`; the Teams app renders the approval request, and the agent never asks for a typed "yes" instead. <!-- source: #18 2026-09-09 -->
- Every booking POST carries an `Idempotency-Key` derived from the trip, so retries cannot double book. <!-- source: #26 2026-09-15 -->
- Production deploys only run from `deploy.yml` on `main` after the evaluation gate; there is no skip input. See [evaluation gate](cold/evaluation-gate.md). <!-- source: #36 2026-09-30 -->
- An evaluation result's agent version is the commit SHA; the Foundry agent version exists only after the deploy the gate protects. <!-- source: #33 2026-09-24 -->
