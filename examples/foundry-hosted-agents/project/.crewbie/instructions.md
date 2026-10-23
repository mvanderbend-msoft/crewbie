# Crewbie shared working rules

Work only on the approved task. Respect its acceptance criteria, scope and
prerequisites. If scope or model must change, stop for approval. Preserve existing
behavior and report legacy failures separately. Ask the coordinator for targeted
specialist advice rather than expanding the task.
Surface contradictory guidance instead of choosing a new policy.

Work economically: every tool call resends your whole context. Batch independent
reads and commands into one call and trim output (tail, grep, quiet flags).
Size checks to the change; do not install browsers or new tools unless the task
needs them. Embedded memory is already read; open it again only to edit it.
In cloud sessions `gh` may have no credentials; use git and the task text.
Crewbie records which memory it embedded; do not spend output listing files read.
The cloud host supplies your active charter; respect protected profile paths
rather than trying another way to read them.

Before handoff, put downstream contracts and integration notes in the PR's
Handoff section, not in memory; dependent tasks read the merged code and PR.
Your own hot memory is always in scope: update it on the work branch unless a
human explicitly says otherwise. Hot memory holds gotchas only: non-obvious traps,
surprising constraints or failed approaches that would cost a future task time.
Write each as one or two lines: the rule and its reason inline, then its source
as a trailing comment, for example:
`- Seed data resets on restart, so tests create users. <!-- source: #42 2026-09-29 -->`
Launches hide comments; read the file before replacing or removing an entry to
see its source. Never
record implementation summaries, scope notes, verification logs, command output
or anything discoverable from the code. Replace or remove stale entries rather
than appending; use index/cold only for longer detail a gotcha links to.
Add new entries at the end. When a hot file exceeds its word budget (shown where
memory is embedded), Crewbie moves the oldest entries to a linked cold topic.
If nothing was surprising, leave memory unchanged and say why in Learning;
"no new durable lesson" alone is insufficient. When your task makes a new
cross-role choice other roles must follow (a shared contract, convention or
technology choice), add or replace one or two lines in `.crewbie/decisions/hot.md`
with the reason and a source comment; this is always in scope. Preserve accepted decisions. For useful out-of-scope learning, post one PR comment starting
with `<!-- crewbie-memory-proposal -->`: target, lesson, reason and source for
nightly review. Report Handoff and Learning separately in the PR.
Write entries as plain lines, with no "proposed" marker: merging the PR is the
review. Exclude raw transcripts.

Use plain, concrete language. Lead with the result; explain terms and uncertainty.
Give reasons and evidence, not a thinking transcript.
Use the repository PR template and `## What changed`, `## Why`, and `## Checks`
headings. Name actual commands and
outcomes, unrun checks and material risks. Link detail; keep telemetry separate.
Never imply an unrun check passed.
If your charter defines a persona or voice, write PR descriptions, comments and
Learning in it while staying accurate; keep memory files neutral.
