# Contoso Travel concierge

Microsoft Foundry hosted agent built with Microsoft Agent Framework (Python 3.13, uv). The service is defined in `azure.yaml`; the code is in `src/concierge`. Project context and open decisions: `docs/destination.md`.

## Commands

- Install: `uv sync --frozen` in `src/concierge`.
- Run locally: `azd ai agent run` (host on http://localhost:8088, Docker required), then `azd ai agent invoke --local "Plan a trip to Seattle next Tuesday"`.
- Test: `uv run pytest` in `src/concierge`.
- Deploy: `azd deploy`, then `azd ai agent invoke "..."` against the new agent version.

## Rules

- Never hard-code endpoints, keys or model names. The host injects `FOUNDRY_PROJECT_ENDPOINT` and `AZURE_AI_MODEL_DEPLOYMENT_NAME`; locally they come from `src/concierge/.env` (copy `.env.example`, never commit `.env`).
- Authenticate with `DefaultAzureCredential` only; the hosted agent runs as its own Entra agent identity.
- Every tool that books, changes or cancels a trip uses `@tool(approval_mode="always_require")`.
- For guided Foundry deployment, evaluation and troubleshooting, use the Microsoft Foundry Skill: `npx skills add https://github.com/microsoft/azure-skills --skill microsoft-foundry`.
