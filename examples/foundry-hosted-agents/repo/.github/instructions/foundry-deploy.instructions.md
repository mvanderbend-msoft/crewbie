---
applyTo: "azure.yaml,src/concierge/Dockerfile,.github/workflows/**"
---
# Foundry deployment

- `azure.yaml` uses `infra.provider: microsoft.foundry`: azd provisions the Foundry project and the model deployments listed under `ai-project`. Change models there, not in code.
- Keep the container listening on port 8088 and `PYTHONNOUSERSITE=1`; the Foundry host expects both.
- Workflows sign in to Azure with OIDC federated credentials; deploying needs the Foundry Project Manager role on the project, never subscription Owner.
