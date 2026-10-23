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
