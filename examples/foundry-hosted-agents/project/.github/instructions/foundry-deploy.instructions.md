---
applyTo: "azure.yaml,src/concierge/Dockerfile,.github/workflows/**,scripts/**"
---
# Foundry deployment

- `azure.yaml` uses `infra.provider: microsoft.foundry`: azd provisions the Foundry project and the model deployments listed under `ai-project`. Change models there, not in code.
- Keep the container listening on port 8088 and `PYTHONNOUSERSITE=1`; the Foundry host expects both.
- Workflows sign in to Azure with OIDC federated credentials; deploying needs the Foundry Project Manager role on the project, never subscription Owner.
- Grants to the agent identity live in `scripts/grant-agent-access.sh`, run by the concierge `postdeploy` hook: the identity only exists after a deploy, so `azd provision --preview` never shows them. Keep every grant idempotent.
