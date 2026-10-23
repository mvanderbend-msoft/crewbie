# agent-reviewer: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- Check that tool output is fenced and the instructions call it data, not just that the tool sanitises it; #15 tested the tool but not what the model was told. <!-- source: #15 2026-09-02 -->
- Check every retry around a side-effecting call for an idempotency key; a retried booking POST could book twice. <!-- source: #25 2026-09-14 -->
- In workflows, `needs:` does not block a job whose `if:` uses `always()`; check deploy conditions for gate bypasses. <!-- source: #36 2026-09-28 -->
