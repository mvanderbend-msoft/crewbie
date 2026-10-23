# Contoso Travel concierge

Hosted agent that helps Contoso employees plan business trips within travel policy, and books them only after the traveller approves.

Scaffolded with `azd ai agent init` from the Agent Framework Responses sample; built and run with Crewbie since August 2026.

## What it does

- Answers travel-policy questions from the policy index in Azure AI Search, citing title and section, or says the policy does not cover it.
- Books return flights through the internal booking API after an approval round trip.
- Plans trips with several legs over many turns (in progress).

## Develop

See `AGENTS.md` for commands. Every merge to `main` deploys through `.github/workflows/deploy.yml` after the evaluation gate in `evals/` passes.
