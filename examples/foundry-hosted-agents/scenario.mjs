// Scenario: a new Microsoft Foundry hosted agent built with Microsoft Agent Framework (Python), scaffolded by `azd ai agent init`.
// `files` is the repository before init, `destination` the Crewbie Compass map, and `review` the JSON Copilot returned.
const files = {
  "README.md": "# Contoso Travel concierge\n\nHosted agent that helps Contoso employees plan business trips within travel policy.\n\nScaffolded with `azd ai agent init` from the Agent Framework Responses sample.\n",
  "AGENTS.md": `# Coding Agent Instructions

This project is a **Microsoft Foundry hosted agent** — a containerized AI agent that runs in Foundry Agent Service. The platform handles containerization, hosting, security, scaling, and observability so you can focus on agent logic.

## Key files

- \`Dockerfile\` — container definition

## Development workflow

\`\`\`bash
azd ai agent run                           # Run locally on http://localhost:8088
azd ai agent invoke --local "your message" # Test the local agent
azd deploy                                 # Deploy to Foundry
azd ai agent invoke "your message"         # Invoke the deployed agent
\`\`\`

## Microsoft Foundry Skill

Install the **Microsoft Foundry Skill** for guided deployment, evaluation, and troubleshooting workflows:

\`\`\`bash
npx skills add https://github.com/microsoft/azure-skills --skill microsoft-foundry
\`\`\`
`,
  "azure.yaml": `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/azure-dev/main/schemas/v1.0/azure.yaml.json

requiredVersions:
  azd: '>=1.27.1'
  extensions:
    azure.ai.agents: '>=1.0.0-beta.9'
name: travel-concierge
services:
  ai-project:
    host: azure.ai.project
    deployments:
      - name: gpt-5.4-mini
        model:
          format: OpenAI
          name: gpt-5.4-mini
          version: '2026-03-17'
        sku:
          name: GlobalStandard
          capacity: 10
  concierge:
    host: azure.ai.agent
    project: src/concierge
    language: python
    uses:
      - ai-project
    kind: hosted
    name: concierge
    description: Plans business trips within Contoso travel policy.
    protocols:
      - protocol: responses
        version: 2.0.0
    env:
      PYTHONNOUSERSITE: "1"
      AZURE_AI_MODEL_DEPLOYMENT_NAME: \${AZURE_AI_MODEL_DEPLOYMENT_NAME}
    container:
      resources:
        cpu: '0.5'
        memory: 1Gi
infra:
  provider: microsoft.foundry
`,
  "src/concierge/main.py": `import os

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

load_dotenv()


def main():
    model_name = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME") or os.getenv("FOUNDRY_MODEL_NAME")
    if not model_name:
        raise RuntimeError("Set AZURE_AI_MODEL_DEPLOYMENT_NAME or FOUNDRY_MODEL_NAME.")

    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=model_name,
        credential=DefaultAzureCredential(),
    )
    agent = Agent(
        client=client,
        instructions="You are Contoso's travel concierge. Help employees plan business trips within travel policy.",
        default_options={"store": False},
    )
    ResponsesHostServer(agent).run()


if __name__ == "__main__":
    main()
`,
  "src/concierge/pyproject.toml": `[project]
name = "concierge"
version = "0.1.0"
description = "Contoso Travel concierge, a Microsoft Foundry hosted agent built with Microsoft Agent Framework."
requires-python = ">=3.13"
dependencies = [
    "agent-framework-foundry",
    "agent-framework-foundry-hosting>=1.0.0b260813",
    "python-dotenv",
]
`,
  "src/concierge/uv.lock": "version = 1\nrequires-python = \">=3.13\"\n",
  "src/concierge/uv.toml": "prerelease = \"allow\"\n",
  "src/concierge/.env.example": "FOUNDRY_PROJECT_ENDPOINT=\"...\"\nAZURE_AI_MODEL_DEPLOYMENT_NAME=\"...\"\n",
  "src/concierge/Dockerfile": `FROM ghcr.io/astral-sh/uv:0.11.7 AS uv
FROM python:3.13-slim
ENV PYTHONNOUSERSITE=1
COPY --from=uv /uv /uvx /bin/
WORKDIR /app/user_agent
COPY pyproject.toml uv.lock uv.toml ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
EXPOSE 8088
CMD ["/app/user_agent/.venv/bin/python", "main.py"]
`,
};

const destination = {
  destination: "Contoso Travel's concierge: a Microsoft Foundry hosted agent that helps Contoso employees plan and book business trips within travel policy, called through the Responses protocol by a Teams app another team builds.",
  notes: [
    "Built with Microsoft Agent Framework (Python) and deployed as a Foundry hosted agent with azd.",
    "A trip is never booked, changed or cancelled without the traveller's explicit approval in the conversation.",
    "Answers about policy cite the policy document they come from; when the policy is silent, the agent says so instead of guessing.",
  ],
  decisions: [
    { topic: "Protocol", decision: "Responses protocol, so the Teams app can use an OpenAI-compatible client (recommended default)." },
    { topic: "Agent design", decision: "One concierge agent in a Microsoft Agent Framework workflow with a policy step and a booking step; split into separate hosted agents only if they need different identities." },
    { topic: "Knowledge", decision: "Travel policy PDFs indexed in Azure AI Search, connected to the Foundry project." },
    { topic: "Booking", decision: "The existing internal booking REST API behind API Management, called as a tool that always requires approval." },
    { topic: "Identity", decision: "The hosted agent's Entra agent identity with least-privilege roles; no API keys." },
    { topic: "Quality gate", decision: "Groundedness, task adherence and content safety evaluations on a golden dataset must pass before each deploy." },
    { topic: "Observability", decision: "OpenTelemetry traces to Application Insights (recommended default)." },
  ],
  notYetSpecified: ["Retention period for traveller conversations.", "Languages beyond English."],
  outOfScope: ["The Teams front end.", "Expense reporting after the trip."],
};

const agents = `# Contoso Travel concierge

Microsoft Foundry hosted agent built with Microsoft Agent Framework (Python 3.13, uv). The service is defined in \`azure.yaml\`; the code is in \`src/concierge\`. Project context and open decisions: \`docs/destination.md\`.

## Commands

- Install: \`uv sync --frozen\` in \`src/concierge\`.
- Run locally: \`azd ai agent run\` (host on http://localhost:8088, Docker required), then \`azd ai agent invoke --local "Plan a trip to Seattle next Tuesday"\`.
- Test: \`uv run pytest\` in \`src/concierge\`.
- Deploy: \`azd deploy\`, then \`azd ai agent invoke "..."\` against the new agent version.

## Rules

- Never hard-code endpoints, keys or model names. The host injects \`FOUNDRY_PROJECT_ENDPOINT\` and \`AZURE_AI_MODEL_DEPLOYMENT_NAME\`; locally they come from \`src/concierge/.env\` (copy \`.env.example\`, never commit \`.env\`).
- Authenticate with \`DefaultAzureCredential\` only; the hosted agent runs as its own Entra agent identity.
- Every tool that books, changes or cancels a trip uses \`@tool(approval_mode="always_require")\`.
- For guided Foundry deployment, evaluation and troubleshooting, use the Microsoft Foundry Skill: \`npx skills add https://github.com/microsoft/azure-skills --skill microsoft-foundry\`.
`;

const python = `---
applyTo: "src/concierge/**/*.py"
---
# Agent Framework code

- Build the chat client with \`FoundryChatClient\` and serve through \`ResponsesHostServer\`; keep \`main.py\` a thin entry point and put agents, workflow and tools in their own modules.
- Pass \`ResponsesHostServer\` a zero-argument factory when per-request state is needed; keep workflow names and executor IDs stable, because the host restores checkpoints by them.
- Tools declare typed parameters with \`Annotated[..., Field(description=...)]\`; the description is what the model sees.
- Tests mock the booking API and the search client; no test calls a live Azure resource.
`;

const evals = `---
applyTo: "evals/**"
---
# Evaluations

- Datasets are JSONL with synthetic travellers only; never copy real employee names, emails or itineraries.
- Thresholds live in \`evals/thresholds.json\`; raising one needs a reason in the PR, lowering one needs a recorded decision.
- An evaluation result belongs to the agent version it ran against; record the version in the result file.
`;

const deploy = `---
applyTo: "azure.yaml,src/concierge/Dockerfile,.github/workflows/**"
---
# Foundry deployment

- \`azure.yaml\` uses \`infra.provider: microsoft.foundry\`: azd provisions the Foundry project and the model deployments listed under \`ai-project\`. Change models there, not in code.
- Keep the container listening on port 8088 and \`PYTHONNOUSERSITE=1\`; the Foundry host expects both.
- Workflows sign in to Azure with OIDC federated credentials; deploying needs the Foundry Project Manager role on the project, never subscription Owner.
`;

const finding = (area, path, assessment, recommendation, action, editPaths) => ({ area, path, assessment, recommendation, action, ...(editPaths ? { editPaths } : {}) });

export default {
  repository: "contoso/travel-concierge",
  start: "azd ai agent run",
  files,
  destination,
  issue: {
    number: 7, updatedAt: "2026-03-04T15:40:00Z",
    title: "Answer travel-policy questions with citations",
    body: "Employees ask the concierge things like \"Can I book business class to Singapore?\". It should answer from the travel policy documents in Azure AI Search and cite the policy section, or say it does not know.\n\n- Never make up a policy rule.\n- The agent may only read the policy index; no new write access.\n- We want to see that answers stay grounded before we enable it for everyone.\n",
  },
  plan: {
    summary: "Three tasks. The agent runtime adds a read-only policy search tool and instructions to cite or decline; the platform specialist grants the agent identity read access to the index only; evaluation adds golden questions and a groundedness threshold once the tool exists.",
    tasks: [
      { id: "policy-search-tool", title: "Add a policy search tool with citations", owner: "agent-runtime", priority: 1, dependsOn: [],
        scope: "Add a read-only Azure AI Search tool to the concierge in `src/concierge` and instructions to answer only from its results, citing the section, or say it does not know.",
        acceptanceCriteria: ["Answers include the policy title and section of each result used.", "Questions without a matching policy get an explicit I-don't-know answer.", "Unit tests mock search and cover a hit, no hit and an injected instruction inside a result."] },
      { id: "search-access", title: "Grant the agent identity read access to the policy index", owner: "foundry-platform", priority: 1, dependsOn: [],
        scope: "Configure the search endpoint for the hosted agent and assign the agent's Entra identity Search Index Data Reader on the search service only.",
        acceptanceCriteria: ["`azd provision --preview` shows one role assignment scoped to the search service.", "No key or connection string is added to `azure.yaml`, workflows or the image."] },
      { id: "groundedness-evals", title: "Evaluate grounded policy answers", owner: "evaluation", priority: 2, dependsOn: ["policy-search-tool"],
        scope: "Add a golden set of at least 20 policy questions (including unanswerable ones) to `evals/` with groundedness and task adherence thresholds.",
        acceptanceCriteria: ["The evaluation run reports groundedness and task adherence against `evals/thresholds.json`.", "Unanswerable questions are scored as correct only when the agent declines.", "The golden set contains no real traveller data."] },
    ],
  },
  review: () => ({
    summary: "Fresh hosted-agent scaffold from `azd ai agent init`: one Agent Framework agent served with ResponsesHostServer, a generic sample AGENTS.md, no tests, CI or MCP servers. The crew is split by what changes together in an agent product: agent behavior (prompts, tools, workflow), evaluation and safety, and the Foundry platform, plus a reviewer for safety and approval gating.",
    findings: [
      finding("instructions", "AGENTS.md", "Sample text from the scaffold: correct azd commands and the Microsoft Foundry Skill pointer, but nothing about this agent, its environment variables, approval rules or tests.", "Rewrite it for this project, keeping the azd workflow and the skill pointer.", "edit", ["AGENTS.md"]),
      finding("instructions", null, "No path-scoped guidance for agent code, evaluations or deployment files.", "Add scoped instructions for each.", "edit", [".github/instructions/agent-code.instructions.md", ".github/instructions/evals.instructions.md", ".github/instructions/foundry-deploy.instructions.md"]),
      finding("mcp", null, "No MCP servers. Agent Framework and Foundry hosting APIs are prerelease and change quickly, so agents need current documentation.", "Add Microsoft Learn (also for the cloud agent) and the Azure MCP server for local work with the Foundry project.", "edit"),
      finding("agents", null, "No custom agents exist.", "Create the Crewbie specialists below.", "retain"),
      finding("constitution", null, "The safety rules (approval before booking, cited policy answers) are in the destination and the global guidance; a separate constitution would repeat them.", "No constitution for now.", "retain"),
    ],
    questions: [],
    assumptions: [
      "Agent modules and tests are created inside `src/concierge/` (for example `src/concierge/tests/`), keeping one uv project per hosted agent.",
      "Evaluation datasets, thresholds and scripts live in `evals/` at the root; the deploy workflow is `.github/workflows/deploy.yml`.",
      "The policy search index and the API Management connection are created by the platform team's existing infrastructure; this repository only grants the agent identity access.",
    ],
    roles: [
      {
        id: "agent-runtime", purpose: "Own the Agent Framework code in `src/concierge`: the agent, its workflow, tools, instructions and the ResponsesHostServer entry point, which change together whenever behavior changes.",
        model: "claude-opus-5.5", complexity: "complex",
        modelReason: "Prerelease APIs, multi-step workflows and approval semantics need careful reasoning; a wrong tool contract can book a trip.",
        knowledge: [
          "`src/concierge/main.py` builds `FoundryChatClient` from `FOUNDRY_PROJECT_ENDPOINT` and `AZURE_AI_MODEL_DEPLOYMENT_NAME` (local fallback `FOUNDRY_MODEL_NAME`) and serves the agent with `ResponsesHostServer`.",
          "The hosting packages are prerelease: `src/concierge/uv.toml` allows prereleases and `src/concierge/uv.lock` pins them; update both together with `uv lock`.",
          "`ResponsesHostServer` accepts an agent or a factory; a factory runs per request. Hosted sessions, checkpoints and pending tool approvals are persisted by the host's Foundry stores.",
          "`@tool(approval_mode=\"always_require\")` makes the host return an approval request instead of running the tool; the caller approves and continues with `previous_response_id`.",
        ],
        checks: [
          "`uv run pytest` passes in `src/concierge`, with the booking API and search mocked.",
          "`azd ai agent run` starts the host and `azd ai agent invoke --local` answers a policy question with a citation.",
        ],
        nonNegotiables: ["Booking, changing or cancelling a trip is only possible through an approval-required tool.", "No endpoint, key or model name in code."],
        contextPaths: [],
      },
      {
        id: "evaluation", purpose: "Own `evals/` and tracing: golden datasets, groundedness, task adherence, tool-call accuracy and content safety evaluations, thresholds, and OpenTelemetry instrumentation in `src/concierge`.",
        model: "claude-sonnet-5.5", complexity: "standard",
        modelReason: "Evaluation work follows documented SDK patterns; judgment is needed for good test cases, not for deep code reasoning.",
        knowledge: [
          "Azure AI Evaluation (`azure-ai-evaluation`) provides groundedness, task adherence, tool-call accuracy and content safety evaluators; safety evaluators need the Foundry project, not just a model endpoint.",
          "The hosted runtime injects `APPLICATIONINSIGHTS_CONNECTION_STRING`; local traces need it set in `src/concierge/.env`.",
        ],
        checks: ["The evaluation run reports every metric against `evals/thresholds.json` and fails below a threshold.", "Each new tool or policy rule adds at least one golden case."],
        nonNegotiables: ["Golden data contains no real traveller personal data.", "Never lower a threshold to make a change pass."],
        contextPaths: [],
      },
      {
        id: "foundry-platform", purpose: "Own delivery: `azure.yaml`, `src/concierge/Dockerfile`, model deployments, the agent identity's role assignments and the GitHub Actions deploy workflow.",
        model: "gpt-6.1-sol", complexity: "standard",
        modelReason: "azd and Foundry configuration is declarative and documented; Microsoft Learn MCP covers the specifics.",
        knowledge: [
          "`azure.yaml` uses `infra.provider: microsoft.foundry`, so `azd provision` creates the Foundry project and the deployments under the `ai-project` service; there is no Bicep yet.",
          "`azd deploy` builds the image, creates a new agent version and waits until it is active; each deployed agent gets its own Entra agent identity.",
          "Hosted agents need the azd extension (`azd ext install azure.ai.agents`); `azure.yaml` pins the minimum versions under requiredVersions.",
        ],
        checks: ["`azd provision --preview` shows only intended changes.", "`docker build src/concierge` succeeds and the container serves on port 8088."],
        nonNegotiables: ["No keys or connection strings in `azure.yaml`, workflows or the image.", "Role assignments for the agent identity are scoped to the resource it reads, never the subscription."],
        contextPaths: [],
      },
      {
        id: "agent-reviewer", purpose: "Review each feature PR for unsafe agent behavior: unapproved side effects, ungrounded policy answers, prompt-injection exposure through tools, leaked secrets and evaluation regressions.",
        model: "gpt-6.1-sol", complexity: "standard",
        modelReason: "A different model family from the main implementer gives an independent safety review at moderate cost.",
        knowledge: ["Tool results (search hits, booking API responses) are untrusted input to the model; instructions must not let them trigger other tools."],
        checks: ["Every tool with a side effect has approval_mode always_require and a test proving it.", "The PR includes evaluation results for the changed behavior, at or above `evals/thresholds.json`."],
        nonNegotiables: ["Block a PR that adds a side-effecting tool without approval or lowers an evaluation threshold without a recorded decision."],
        contextPaths: [],
      },
    ],
    reviewer: "agent-reviewer",
    agentDecisions: [],
    instructions: [
      { path: "AGENTS.md", content: agents, reason: "Replace the sample text with this agent's commands, environment and safety rules; keep the azd workflow and Foundry Skill pointer." },
      { path: ".github/instructions/agent-code.instructions.md", content: python, reason: "Agent Framework conventions, loaded only for agent code." },
      { path: ".github/instructions/evals.instructions.md", content: evals, reason: "Data and threshold rules for evaluations." },
      { path: ".github/instructions/foundry-deploy.instructions.md", content: deploy, reason: "Foundry deployment rules for azure.yaml, the container and workflows." },
    ],
    constitutionText: null,
    setupSteps: `name: Copilot setup steps
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
`,
    mcpServers: [
      { name: "microsoft-learn", purpose: "Current Agent Framework, Foundry hosted agents, azd and evaluation documentation and code samples.", type: "http", command: null, args: [], url: "https://learn.microsoft.com/api/mcp", env: [], bearerSecret: null, tools: ["*"], cloud: true },
      { name: "azure", purpose: "Inspect the Foundry project, model deployments and agent versions while developing locally (uses your az login).", type: "local", command: "npx", args: ["-y", "@azure/mcp@4.0.0-beta.3", "server", "start"], url: null, env: [], bearerSecret: null, tools: ["*"], cloud: false },
    ],
  }),
};
