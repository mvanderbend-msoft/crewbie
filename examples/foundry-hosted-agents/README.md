# Foundry hosted agents: Microsoft Agent Framework in Python

**Repository** (`contoso/travel-concierge`): a travel concierge agent built with Microsoft Agent Framework (`agent-framework-foundry` and `agent-framework-foundry-hosting`). It is served by `ResponsesHostServer` from `src/concierge` and deployed as a Microsoft Foundry hosted agent with `azd` (`host: azure.ai.agent`, `infra.provider: microsoft.foundry`). The layout follows the official [foundry-samples](https://github.com/microsoft-foundry/foundry-samples) hosted-agent template: Python 3.13, uv and a Dockerfile on port 8088. An `AGENTS.md` already exists.

**Destination** (from Crewbie Compass): an internal concierge that answers travel-policy questions and books trips only after human approval. Answers must be grounded in policy documents and checked by evaluations before rollout. See [`repo/docs/destination.md`](repo/docs/destination.md).

## Team

| Role | Model | Why this split |
| --- | --- | --- |
| `agent-runtime` | claude-opus-5.5 (complex) | Agent code, tools, instructions and the hosting entry point. The APIs are prerelease, and a wrong tool contract can book a trip. |
| `evaluation` | claude-sonnet-5.5 | Golden datasets, groundedness and safety evaluators, thresholds and tracing. |
| `foundry-platform` | gpt-6.1-sol | `azure.yaml`, model deployments, the agent identity's role assignments and deployment. |
| `agent-reviewer` | gpt-6.1-sol | Reviews feature PRs for unapproved side effects, prompt injection through tool results, leaked secrets and evaluation regressions. |

Evaluation is a separate specialist because agent behavior is only as trustworthy as its tests. That role must never lower a threshold to make a change pass.

## Guidance

- `AGENTS.md` is updated. It keeps the sample's accurate commands (`azd ai agent run`, `azd ai agent invoke --local`, `azd deploy`) and adds the approval and grounding rules.
- Path-scoped instructions: `agent-code` (`src/concierge/**/*.py`), `evals` and `foundry-deploy`.
- There is no constitution, because the rules fit in `AGENTS.md` and the destination.
- `copilot-setup-steps.yml` installs Python 3.13 and uv and runs `uv sync --frozen` in `src/concierge`.
- MCP servers in `.vscode/mcp.json`: Microsoft Learn (remote, also for the cloud agent) and Azure MCP (local). For Foundry-specific tooling in your editor, you can also add the Microsoft Foundry skill: `npx skills add https://github.com/microsoft/azure-skills --skill microsoft-foundry`.

## Issue to plan

[`issue.md`](issue.md) asks for policy answers with citations. [`plan.json`](plan.json) has three tasks:

- `policy-search-tool` (agent-runtime) and `search-access` (foundry-platform, read-only RBAC on the search service) run in parallel.
- `groundedness-evals` (evaluation) runs once the tool exists.
