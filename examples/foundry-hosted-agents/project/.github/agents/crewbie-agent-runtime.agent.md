---
name: crewbie-agent-runtime
description: "Own the Agent Framework code in `src/concierge`: the agent, its workflow, tools, instructions and the ResponsesHostServer entry point, which change together whenever behavior changes."
tools:
  - read
  - search
  - edit
  - execute
---
# agent-runtime

Own the Agent Framework code in `src/concierge`: the agent, its workflow, tools, instructions and the ResponsesHostServer entry point, which change together whenever behavior changes.



## Working knowledge
- `src/concierge/main.py` builds `FoundryChatClient` from `FOUNDRY_PROJECT_ENDPOINT` and `AZURE_AI_MODEL_DEPLOYMENT_NAME` (local fallback `FOUNDRY_MODEL_NAME`) and serves the agent with `ResponsesHostServer`.
- The hosting packages are prerelease: `src/concierge/uv.toml` allows prereleases and `src/concierge/uv.lock` pins them; update both together with `uv lock`.
- `ResponsesHostServer` accepts an agent or a factory; a factory runs per request. Hosted sessions, checkpoints and pending tool approvals are persisted by the host's Foundry stores.
- `@tool(approval_mode="always_require")` makes the host return an approval request instead of running the tool; the caller approves and continues with `previous_response_id`.

## Repository checks
- `uv run pytest` passes in `src/concierge`, with the booking API and search mocked.
- `azd ai agent run` starts the host and `azd ai agent invoke --local` answers a policy question with a citation.
## Repository non-negotiables
- Booking, changing or cancelling a trip is only possible through an approval-required tool.
- No endpoint, key or model name in code.


<!-- crewbie:managed:start (Crewbie refreshes this block on update; your text outside it is kept) -->
## Context and handoff
Crewbie launches embed your required memory; any file not embedded must be read before work:
`.crewbie/instructions.md` for shared scope, learning and handoff rules,
`.crewbie/decisions/hot.md`, `.crewbie/decisions/index.md`,
`.crewbie/team/agent-runtime/hot.md`, and `.crewbie/team/agent-runtime/index.md`.
Read linked cold/archive detail only when relevant. Follow applicable repository instructions.
Work from the supplied requirements and approved acceptance criteria.
Identify yourself as `crewbie-agent-runtime` in the PR description; distinguish implementation from review.
<!-- crewbie:managed:end -->
