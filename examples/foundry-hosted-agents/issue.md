# Answer travel-policy questions with citations

Employees ask the concierge things like "Can I book business class to Singapore?". It should answer from the travel policy documents in Azure AI Search and cite the policy section, or say it does not know.

- Never make up a policy rule.
- The agent may only read the policy index; no new write access.
- We want to see that answers stay grounded before we enable it for everyone.
