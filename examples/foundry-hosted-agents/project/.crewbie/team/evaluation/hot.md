# evaluation: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- Score unanswerable policy questions with `decline_accuracy`, not groundedness; a decline has no context and groundedness fails it. <!-- source: #14 2026-09-01 -->
- Use only `E0###` traveller IDs and `TRV-TEST-` references in datasets; review flagged realistic names in the first draft. See [golden data](cold/golden-data.md). <!-- source: #14 2026-08-31 -->
- Pass `tool_definitions.json` with every tool-call accuracy row; without it every booking row came back not applicable and the metric looked like it passed. <!-- source: #24 2026-09-13 -->
- `ContentSafetyEvaluator` needs the Foundry project and the CI identity needs Azure AI User on it; the model endpoint alone returns 403. <!-- source: #33 2026-09-23 -->
- Multi-turn rows replay earlier turns from the dataset instead of the agent's answers; otherwise one weak turn fails the whole row and hides the final-turn score. <!-- source: #45 2026-10-20 -->
