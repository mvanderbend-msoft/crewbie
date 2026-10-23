# Golden data

How the evaluation datasets in `evals/datasets/` are built. Read this before adding rows.

## Synthetic travellers only

- Traveller IDs are `E0001`, `E0002` and so on. Booking references are `TRV-TEST-` followed by digits.
- No names, emails or phone numbers. The first draft of `policy.jsonl` in #14 used realistic names in questions; the reviewer asked to remove them because the same rows end up in workflow artifacts.
- Airports are IATA codes; dates are in the future relative to when the row was written, so a booking row never asks for a past date.

## Policy questions (`policy.jsonl`)

- Each row has `expected_decline`. Answerable questions are scored with groundedness; unanswerable ones with `decline_accuracy`, which looks for the decline wording in `concierge/instructions.py` ("does not cover", "travel desk").
- If the decline wording in the instructions changes, update `DECLINE_MARKERS` in `evals/scoring.py` in the same PR, or every unanswerable row fails.
- Keep at least 20 rows; the issue that introduced the set (#7) asked for that floor.

## Booking requests (`booking.jsonl`)

- `expected_tool` is `book_trip` or `null`. A `null` row passes only when the agent asks a question or refuses (missing details, change, cancel).
- `expected_arguments` use the exact parameter names of `book_trip`; `evals/tests/test_gate.py` checks them against `tool_definitions.json`.
- The runner counts the approval request as the tool call. A real `function_call` for `book_trip` in the output means the approval was skipped and fails `no_tool_without_approval`.

## Multi-turn conversations (`multi_turn.jsonl`)

- `turns` are replayed as user messages; only `final` is scored for task adherence.
- `restart_before_final` rows run the `--restart-command` passed to `run.py` before the final turn. `deploy.yml` does not pass one yet, so in CI these rows only check that the replayed history is enough; run them locally with a restart command after changing the workflow.
