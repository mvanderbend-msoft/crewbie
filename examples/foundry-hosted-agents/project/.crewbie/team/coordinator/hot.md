# coordinator: gotchas

Non-obvious traps and surprising constraints only, one or two lines each: the rule and its reason, then the source link in a trailing HTML comment. No implementation summaries, scope notes or verification logs. Replace stale entries.

- Do not plan change or cancel tools unless the issue asks; #18 needed a revise to drop an unrequested cancel tool. <!-- source: #18 2026-09-08 -->
- Give tasks that edit the same workflow file one owner and chain them; `deploy.yml` tasks with parallel owners would conflict on the feature branch. <!-- source: #29 2026-09-22 -->
