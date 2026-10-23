# Contoso Travel concierge

Microsoft Foundry hosted agent built with Microsoft Agent Framework (Python 3.13, uv). The service is defined in `azure.yaml`; the code is in `src/concierge`, evaluations in `evals/`. Project context and open decisions: `docs/destination.md`.

## Commands

- Install: `uv sync --frozen` in `src/concierge` and in `evals` (two separate uv projects).
- Run locally: `azd ai agent run` (host on http://localhost:8088, Docker required), then `azd ai agent invoke --local "Plan a trip to Seattle next Tuesday"`.
- Test: `uv run pytest` in `src/concierge` and in `evals`.
- Evaluate: start the host, then `uv run python run.py --target http://localhost:8088 --agent-version <commit-sha>` in `evals`. It fails below `evals/thresholds.json`.
- Deploy: merge to `main`; `.github/workflows/deploy.yml` runs the evaluation gate, then `azd deploy`. Run `azd deploy` by hand only against your own azd environment, never production.

## Rules

- Never hard-code endpoints, keys or model names. The host injects `FOUNDRY_PROJECT_ENDPOINT` and `AZURE_AI_MODEL_DEPLOYMENT_NAME`; the search and booking settings come from the azd environment through `azure.yaml`. Locally they come from `src/concierge/.env` (copy `.env.example`, never commit `.env`).
- Authenticate with `DefaultAzureCredential` only; the hosted agent runs as its own Entra agent identity.
- Every tool that books, changes or cancels a trip uses `@tool(approval_mode="always_require")`.
- Tool output reaches the model fenced as data (`concierge/fencing.py`); never return raw search or API text.
- For guided Foundry deployment, evaluation and troubleshooting, use the Microsoft Foundry Skill: `npx skills add https://github.com/microsoft/azure-skills --skill microsoft-foundry`.
