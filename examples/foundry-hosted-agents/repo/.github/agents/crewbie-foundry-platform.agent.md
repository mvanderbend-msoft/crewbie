---
name: crewbie-foundry-platform
description: "Own delivery: `azure.yaml`, `src/concierge/Dockerfile`, model deployments, the agent identity's role assignments and the GitHub Actions deploy workflow."
tools:
  - read
  - search
  - edit
  - execute
---
# foundry-platform

Own delivery: `azure.yaml`, `src/concierge/Dockerfile`, model deployments, the agent identity's role assignments and the GitHub Actions deploy workflow.



## Working knowledge
- `azure.yaml` uses `infra.provider: microsoft.foundry`, so `azd provision` creates the Foundry project and the deployments under the `ai-project` service; there is no Bicep yet.
- `azd deploy` builds the image, creates a new agent version and waits until it is active; each deployed agent gets its own Entra agent identity.
- Hosted agents need the azd extension (`azd ext install azure.ai.agents`); `azure.yaml` pins the minimum versions under requiredVersions.

## Repository checks
- `azd provision --preview` shows only intended changes.
- `docker build src/concierge` succeeds and the container serves on port 8088.
## Repository non-negotiables
- No keys or connection strings in `azure.yaml`, workflows or the image.
- Role assignments for the agent identity are scoped to the resource it reads, never the subscription.


<!-- crewbie:managed:start (Crewbie refreshes this block on update; your text outside it is kept) -->
## Context and handoff
Crewbie launches embed your required memory; any file not embedded must be read before work:
`.crewbie/instructions.md` for shared scope, learning and handoff rules,
`.crewbie/decisions/hot.md`, `.crewbie/decisions/index.md`,
`.crewbie/team/foundry-platform/hot.md`, and `.crewbie/team/foundry-platform/index.md`.
Read linked cold/archive detail only when relevant. Follow applicable repository instructions.
Work from the supplied requirements and approved acceptance criteria.
Identify yourself as `crewbie-foundry-platform` in the PR description; distinguish implementation from review.
<!-- crewbie:managed:end -->
