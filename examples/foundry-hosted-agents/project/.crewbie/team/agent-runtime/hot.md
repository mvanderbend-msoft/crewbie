# agent-runtime: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- Run `uv lock` in `src/concierge` after any `pyproject.toml` change; CI and the setup steps use `uv sync --frozen` and fail on a stale lock. <!-- source: #13 2026-08-30 -->
- Return tool output only through `fence()` in `concierge/fencing.py`; raw search text reached the model as instructions in review, and the instructions only trust fenced tags as data. <!-- source: #16 2026-09-03 -->
- Assert `approval_mode` on the tools from `build_tools`, which the workflow registers; the first test checked a freshly built tool and passed while the agent got an unwrapped function. <!-- source: #23 2026-09-12 -->
- Renaming or retyping a tool parameter also needs `evals/datasets/tool_definitions.json` and `booking.jsonl` updated; tool-call accuracy compares argument names and drops to zero otherwise. <!-- source: #27 2026-09-18 -->
- A pending approval resumed after a host restart replays the `booking` executor from its start, so nothing in that step may call an API before `book_trip` runs. <!-- source: #44 2026-10-16 -->
