---
applyTo: "evals/**"
---
# Evaluations

- Datasets are JSONL with synthetic travellers only; never copy real employee names, emails or itineraries.
- Thresholds live in `evals/thresholds.json`; raising one needs a reason in the PR, lowering one needs a recorded decision.
- An evaluation result belongs to the agent version it ran against; record the version in the result file.
