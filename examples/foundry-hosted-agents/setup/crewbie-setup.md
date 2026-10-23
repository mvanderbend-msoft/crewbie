# Crewbie assessment

Fresh hosted-agent scaffold from `azd ai agent init`: one Agent Framework agent served with ResponsesHostServer, a generic sample AGENTS.md, no tests, CI or MCP servers. The crew is split by what changes together in an agent product: agent behavior (prompts, tools, workflow), evaluation and safety, and the Foundry platform, plus a reviewer for safety and approval gating.

## Assumptions

Copilot chose these defaults where evidence or answers were missing. Correct any that are wrong in the guidance or roles before applying.

- Agent modules and tests are created inside `src/concierge/` (for example `src/concierge/tests/`), keeping one uv project per hosted agent.
- Evaluation datasets, thresholds and scripts live in `evals/` at the root; the deploy workflow is `.github/workflows/deploy.yml`.
- The policy search index and the API Management connection are created by the platform team's existing infrastructure; this repository only grants the agent identity access.

## Destination (docs/destination.md)

Charted in the setup interview. Installed only when the file does not exist yet.

```markdown
# Destination

Contoso Travel's concierge: a Microsoft Foundry hosted agent that helps Contoso employees plan and book business trips within travel policy, called through the Responses protocol by a Teams app another team builds.

## Notes

- Built with Microsoft Agent Framework (Python) and deployed as a Foundry hosted agent with azd.
- A trip is never booked, changed or cancelled without the traveller's explicit approval in the conversation.
- Answers about policy cite the policy document they come from; when the policy is silent, the agent says so instead of guessing.

## Decisions so far

- **Protocol**: Responses protocol, so the Teams app can use an OpenAI-compatible client (recommended default).
- **Agent design**: One concierge agent in a Microsoft Agent Framework workflow with a policy step and a booking step; split into separate hosted agents only if they need different identities.
- **Knowledge**: Travel policy PDFs indexed in Azure AI Search, connected to the Foundry project.
- **Booking**: The existing internal booking REST API behind API Management, called as a tool that always requires approval.
- **Identity**: The hosted agent's Entra agent identity with least-privilege roles; no API keys.
- **Quality gate**: Groundedness, task adherence and content safety evaluations on a golden dataset must pass before each deploy.
- **Observability**: OpenTelemetry traces to Application Insights (recommended default).

## Not yet specified

- Retention period for traveller conversations.
- Languages beyond English.

## Out of scope

- The Teams front end.
- Expense reporting after the trip.

<!-- Charted by crewbie init (Crewbie Compass interview). Keep it current: agents read it for project context and init reuses it. -->
```

## Proposed crew

| Specialist | Action | Model | Responsibility |
| --- | --- | --- | --- |
| agent-runtime | New specialist | claude-opus-5.5 | Own the Agent Framework code in `src/concierge`: the agent, its workflow, tools, instructions and the ResponsesHostServer entry point, which change together whenever behavior changes. |
| evaluation | New specialist | claude-sonnet-5.5 | Own `evals/` and tracing: golden datasets, groundedness, task adherence, tool-call accuracy and content safety evaluations, thresholds, and OpenTelemetry instrumentation in `src/concierge`. |
| foundry-platform | New specialist | gpt-6.1-sol | Own delivery: `azure.yaml`, `src/concierge/Dockerfile`, model deployments, the agent identity's role assignments and the GitHub Actions deploy workflow. |
| agent-reviewer | New specialist | gpt-6.1-sol | Review each feature PR for unsafe agent behavior: unapproved side effects, ungrounded policy answers, prompt-injection exposure through tools, leaked secrets and evaluation regressions. |

Concurrency: 2 active sessions. This is not a limit on team size.
PR reviewer: crewbie-agent-reviewer reviews each feature PR before you merge it into the default branch.

Model profile: **balanced**. Explicit model overrides remain authoritative.
Crewbie launch limits: **20 per batch / 3 per task**, including the first attempt and uncertain requests. No feature token ceiling (set `execution.maxTokensPerFeature` to add one). Not a monetary cap.

### agent-runtime

**Working knowledge**
- `src/concierge/main.py` builds `FoundryChatClient` from `FOUNDRY_PROJECT_ENDPOINT` and `AZURE_AI_MODEL_DEPLOYMENT_NAME` (local fallback `FOUNDRY_MODEL_NAME`) and serves the agent with `ResponsesHostServer`.
- The hosting packages are prerelease: `src/concierge/uv.toml` allows prereleases and `src/concierge/uv.lock` pins them; update both together with `uv lock`.
- `ResponsesHostServer` accepts an agent or a factory; a factory runs per request. Hosted sessions, checkpoints and pending tool approvals are persisted by the host's Foundry stores.
- `@tool(approval_mode="always_require")` makes the host return an approval request instead of running the tool; the caller approves and continues with `previous_response_id`.

**Checks**
- `uv run pytest` passes in `src/concierge`, with the booking API and search mocked.
- `azd ai agent run` starts the host and `azd ai agent invoke --local` answers a policy question with a citation.

**Model proposal (complex):** Prerelease APIs, multi-step workflows and approval semantics need careful reasoning; a wrong tool contract can book a trip.

**Boundaries**
- Booking, changing or cancelling a trip is only possible through an approval-required tool.
- No endpoint, key or model name in code.

### evaluation

**Working knowledge**
- Azure AI Evaluation (`azure-ai-evaluation`) provides groundedness, task adherence, tool-call accuracy and content safety evaluators; safety evaluators need the Foundry project, not just a model endpoint.
- The hosted runtime injects `APPLICATIONINSIGHTS_CONNECTION_STRING`; local traces need it set in `src/concierge/.env`.

**Checks**
- The evaluation run reports every metric against `evals/thresholds.json` and fails below a threshold.
- Each new tool or policy rule adds at least one golden case.

**Model proposal (standard):** Evaluation work follows documented SDK patterns; judgment is needed for good test cases, not for deep code reasoning.

**Boundaries**
- Golden data contains no real traveller personal data.
- Never lower a threshold to make a change pass.

### foundry-platform

**Working knowledge**
- `azure.yaml` uses `infra.provider: microsoft.foundry`, so `azd provision` creates the Foundry project and the deployments under the `ai-project` service; there is no Bicep yet.
- `azd deploy` builds the image, creates a new agent version and waits until it is active; each deployed agent gets its own Entra agent identity.
- Hosted agents need the azd extension (`azd ext install azure.ai.agents`); `azure.yaml` pins the minimum versions under requiredVersions.

**Checks**
- `azd provision --preview` shows only intended changes.
- `docker build src/concierge` succeeds and the container serves on port 8088.

**Model proposal (standard):** azd and Foundry configuration is declarative and documented; Microsoft Learn MCP covers the specifics.

**Boundaries**
- No keys or connection strings in `azure.yaml`, workflows or the image.
- Role assignments for the agent identity are scoped to the resource it reads, never the subscription.

### agent-reviewer

**Working knowledge**
- Tool results (search hits, booking API responses) are untrusted input to the model; instructions must not let them trigger other tools.

**Checks**
- Every tool with a side effect has approval_mode always_require and a test proving it.
- The PR includes evaluation results for the changed behavior, at or above `evals/thresholds.json`.

**Model proposal (standard):** A different model family from the main implementer gives an independent safety review at moderate cost.

**Boundaries**
- Block a PR that adds a side-effecting tool without approval or lowers an evaluation threshold without a recorded decision.

## Proposed guidance edits

4 concrete edits. These are applied only when guidance changes are approved.

### AGENTS.md

Replace the sample text with this agent's commands, environment and safety rules; keep the azd workflow and Foundry Skill pointer.

```markdown
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

```

### .github/instructions/agent-code.instructions.md

Agent Framework conventions, loaded only for agent code.

```markdown
---
applyTo: "src/concierge/**/*.py"
---
# Agent Framework code

- Build the chat client with `FoundryChatClient` and serve through `ResponsesHostServer`; keep `main.py` a thin entry point and put agents, workflow and tools in their own modules.
- Pass `ResponsesHostServer` a zero-argument factory when per-request state is needed; keep workflow names and executor IDs stable, because the host restores checkpoints by them.
- Tools declare typed parameters with `Annotated[..., Field(description=...)]`; the description is what the model sees.
- Tests mock the booking API and the search client; no test calls a live Azure resource.

```

### .github/instructions/evals.instructions.md

Data and threshold rules for evaluations.

```markdown
---
applyTo: "evals/**"
---
# Evaluations

- Datasets are JSONL with synthetic travellers only; never copy real employee names, emails or itineraries.
- Thresholds live in `evals/thresholds.json`; raising one needs a reason in the PR, lowering one needs a recorded decision.
- An evaluation result belongs to the agent version it ran against; record the version in the result file.

```

### .github/instructions/foundry-deploy.instructions.md

Foundry deployment rules for azure.yaml, the container and workflows.

```markdown
---
applyTo: "azure.yaml,src/concierge/Dockerfile,.github/workflows/**"
---
# Foundry deployment

- `azure.yaml` uses `infra.provider: microsoft.foundry`: azd provisions the Foundry project and the model deployments listed under `ai-project`. Change models there, not in code.
- Keep the container listening on port 8088 and `PYTHONNOUSERSITE=1`; the Foundry host expects both.
- Workflows sign in to Azure with OIDC federated credentials; deploying needs the Foundry Project Manager role on the project, never subscription Owner.

```

### .github/workflows/copilot-setup-steps.yml

Runs before each Copilot cloud agent session so agents start with dependencies installed. Created only when absent; applied with the guidance choice.

```yaml
name: Copilot setup steps
on:
  workflow_dispatch:
  push:
    paths: [.github/workflows/copilot-setup-steps.yml]
  pull_request:
    paths: [.github/workflows/copilot-setup-steps.yml]
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --frozen
        working-directory: src/concierge
```

## Proposed MCP servers

Applied with the guidance choice. Crewbie creates the local file only when it does not exist; never store secret values in it.

- **microsoft-learn** (http, also cloud agent): Current Agent Framework, Foundry hosted agents, azd and evaluation documentation and code samples.
- **azure** (local): Inspect the Foundry project, model deployments and agent versions while developing locally (uses your az login).

### .vscode/mcp.json

```json
{
  "servers": {
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp"
    },
    "azure": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@azure/mcp@4.0.0-beta.3",
        "server",
        "start"
      ]
    }
  }
}
```

### Copilot cloud agent

Paste into contoso/travel-concierge Settings > Copilot > MCP servers (GitHub and Playwright are already enabled there).

```json
{
  "mcpServers": {
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp",
      "tools": [
        "*"
      ]
    }
  }
}
```

## Hosted planning

Enabled with model `claude-opus-5.5`. The ready-for-planning label authorizes a potentially billable planning run. Execution after a human merges the planning PR: **enabled (the merge approves paid work on the exact plan)**.

## Assessment findings and recommendations

Recommendations are not automatically applied. Only the concrete guidance edits above are proposed writes.

### instructions - AGENTS.md

Sample text from the scaffold: correct azd commands and the Microsoft Foundry Skill pointer, but nothing about this agent, its environment variables, approval rules or tests.

**Recommendation:** Rewrite it for this project, keeping the azd workflow and the skill pointer.

**Disposition:** edit

### instructions

No path-scoped guidance for agent code, evaluations or deployment files.

**Recommendation:** Add scoped instructions for each.

**Disposition:** edit

### mcp

No MCP servers. Agent Framework and Foundry hosting APIs are prerelease and change quickly, so agents need current documentation.

**Recommendation:** Add Microsoft Learn (also for the cloud agent) and the Azure MCP server for local work with the Foundry project.

**Disposition:** edit

### agents

No custom agents exist.

**Recommendation:** Create the Crewbie specialists below.

**Disposition:** retain

### constitution

The safety rules (approval before booking, cited policy answers) are in the destination and the global guidance; a separate constitution would repeat them.

**Recommendation:** No constitution for now.

**Disposition:** retain

## Coverage

AI guidance (agent instructions, custom agents, constitution and MCP metadata, bounded to 256 KB of text) plus redacted build evidence: manifest summaries (scripts, dependencies, engines), non-Crewbie CI workflow text and root file names. Application source, READMEs and other project files are not read; only their names are mapped (directories and workspaces) to check cited paths. Ignored files and personal/global MCP settings are not read. MCP configurations are inspected, never launched; arguments, URLs, headers and credential values are withheld. Builds and server availability are unverified.


## Reviewed installation files

- Create .crewbie/config.json [User policy] - Team, explicit models, approvals and limits; update preserves your configuration.
- Create .crewbie/instructions.md [Crewbie-managed] - Single shared working policy referenced by specialists, not duplicated into each charter.
- Create .github/skills/crewbie/SKILL.md [Crewbie-managed] - Discover the local implementation workflow on demand instead of always loading it.
- Create .github/workflows/crewbie-plan.yml [Crewbie-managed] - Prepare a coordinator plan from approved issue intake; the planning opt-in gate still applies. Human-edited workflows block update.
- Create .github/workflows/crewbie-execute-plan.yml [Crewbie-managed] - Treat a write-access human's merge as execution approval after verifying the exact plan, source and policy before publishing implementation tasks. Human-edited workflows block update.
- Create .github/workflows/crewbie-dispatch.yml [Crewbie-managed] - Release approved tasks when dependencies, capacity and launch controls permit; merge each finished task PR into its plan's feature branch once checks pass, then open the feature PR to the default branch and request its review. Human-edited workflows block update.
- Create .github/workflows/crewbie-review.yml [Crewbie-managed] - Have the configured Crewbie reviewer comment on each task and feature PR head; reads the API diff and never runs PR code. Human-edited workflows block update.
- Create .github/workflows/crewbie-fix.yml [Crewbie-managed] - Run the named Crewbie operation with bounded permissions. Human-edited workflows block update.
- Create .github/workflows/crewbie-maintain.yml [Crewbie-managed] - Offer bounded knowledge-maintenance proposals; scheduled analysis remains opt-in. Human-edited workflows block update.
- Create .github/workflows/crewbie-report.yml [Crewbie-managed] - Collect execution evidence into a static report without starting implementation agents. Human-edited workflows block update.
- Create .vscode/mcp.json [Reviewed MCP configuration] - Proposed local MCP servers; secrets are prompted when a server starts and never written. Created only when absent.
- Create .github/workflows/copilot-setup-steps.yml [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create docs/destination.md [User knowledge] - Purpose, users, constraints, decisions, open questions and scope charted in the setup interview; agents read it for project context. Created when absent; replaced only when revisited in init.
- Update AGENTS.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/agent-code.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/evals.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/instructions/foundry-deploy.instructions.md [Reviewed guidance] - Apply only the separately approved instruction replacement; preserve subsequent edits.
- Create .github/agents/crewbie-agent-runtime.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/agent-runtime/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/agent-runtime/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-evaluation.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/evaluation/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/evaluation/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-foundry-platform.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/foundry-platform/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/foundry-platform/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-agent-reviewer.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/agent-reviewer/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/agent-reviewer/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-coordinator.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/coordinator/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/coordinator/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .github/agents/crewbie-improver.agent.md [Crewbie-managed] - The specialist charter links shared rules and scoped memory; edit freely outside the managed block.
- Create .crewbie/team/improver/hot.md [User knowledge] - Seed current role handoffs and lessons once; existing knowledge is never regenerated by update.
- Create .crewbie/team/improver/index.md [User knowledge] - Seed topic pointers for selective context loading; existing knowledge is never regenerated.
- Create .crewbie/decisions/hot.md [User guidance] - Keep approved principles or shared decisions; reuse existing documents.
- Create .crewbie/decisions/index.md [User guidance] - Seed shared-decision topic pointers; existing knowledge is never regenerated.
- Create .github/PULL_REQUEST_TEMPLATE.md [Crewbie-managed] - Prompt for concise implementation evidence, handoffs and learning.

## Installation choice

Team plus the concrete guidance edits listed above.
