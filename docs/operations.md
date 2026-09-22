# Operating Crewbie

## Human approval and credentials

Commit reviewed setup files to the repository's default branch before dispatch.
Configure `approvers` as individual human GitHub logins. Publication checks the
authenticated user and writes exact-content approval comments; bots and edited
approval comments are not accepted as human approval.

Local GitHub access uses `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth login`.
Cloud assignment needs a supported user-authorized credential, not an ordinary
GitHub App installation token. Follow GitHub's
[current assignment permissions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api).
Do not print tokens, put them in command arguments, or commit them.

Read-only dashboard collection and PR checks use the job-scoped `GITHUB_TOKEN`
with explicit read permissions. They do not require copying a user's saved
credential into Actions secrets. Native assignment still requires its documented
user authentication. Maintenance uses separate built-in job tokens for read-only
preparation, Copilot requests, and guarded branch/PR publication.

The installed workflows use:

| Setting | Purpose |
|---|---|
| Secret `CREWBIE_USER_TOKEN` | Unattended native assignment using a supported user credential; unnecessary for `publish --dispatch-local` |
| Secret `CREWBIE_ADO_TOKEN` | Optional ADO work-item access |
| Variable `CREWBIE_PACKAGE` | An administrator-approved, version-pinned Crewbie package or release tarball |
| Variable `CREWBIE_COPILOT_VERSION` | An approved exact Copilot CLI package version |
| Variable `CREWBIE_MAINTENANCE_MODEL` | Explicit approved maintenance model; not `auto` |
| Variable `CREWBIE_PAGES_MODE` | Leave unset for artifact-only reports; opt into `private` or `public` |
| Config `planning.enabled` / `planning.model` | Opt into ready-label coordinator planning with an explicit model |
| Config `planning.executeOnMerge` | Opt into paid task execution after a verified human approval and merge |

Crewbie is distributed through GitHub Releases, not an npm registry. For this
alpha, configure the consuming repository with the version-pinned public asset:

```powershell
gh variable set CREWBIE_PACKAGE --repo OWNER/REPO --body "https://github.com/mvanderbend-msoft/crewbie/releases/download/v0.1.0-alpha.2/crewbie-cli-0.1.0-alpha.2.tgz"
```

For a reviewed custom build, use `npm pack` and distribute its tarball through
an appropriate release/package channel instead. Generated workflows
deliberately fail if `CREWBIE_PACKAGE` is missing.
Installing the package uses `--ignore-scripts`; the packed `dist` is prebuilt and
has no runtime npm dependencies. Keep credentials out of package URLs.

The nightly analysis job grants only `copilot-requests: write` and uses a recent,
pinned CLI with the built-in token. Personal repositories bill the owner's Copilot
seat; organization repositories require the Copilot CLI organization-billing
policy. See [Copilot CLI Actions authentication](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/copilot-cli-in-github-actions).
The separate publisher needs `contents: write`, `pull-requests: write`, and the
repository setting allowing Actions to create PRs. It never approves or merges a
PR. A missing entitlement or permission is an error, not a token/runtime fallback.

## Account and runtime capability matrix

| Capability | Personal repository | Organization repository | Verified here |
|---|---|---|---|
| Local onboarding/specification | Supported | Supported | Local CLI and fixtures |
| Ready-label issue planning | Opt-in Actions CLI; eligible Copilot seat | Opt-in Actions CLI; organization billing policy | Authorization, source binding, proposal publication and workflow fixtures; no new paid live intake run claimed |
| Approve-and-merge execution | Supported user-authorized assignment credential required | Credential plus repository/organization policy | Exact-head review/merge provenance, team materialization, publication and recovery fixtures; live webshop validation pending |
| Native custom-agent assignment | Requires eligible account/repo and user auth | Requires eligible account/policy and user auth | Named backend, frontend, tester and reviewer sessions in a private Java/React repository; native IDs confirmed |
| Model selection | Requested explicitly; entitlement varies | Requested explicitly; policy varies | `gpt-5.4` confirmed in native session metadata; no universal model guarantee |
| Same-PR review corrections | Agent Tasks API requires an eligible Business/Enterprise seat and user auth | Requires eligible seat/policy and user auth | Two correction rounds reused the original frontend PR, followed by tester refresh and independent re-review |
| Nightly CLI | Built-in token, billed to owner's Copilot seat | Built-in token with organization-billing policy | Private personal repository: preparation, paid analysis, proposal publication and no-new-evidence skip passed |
| Private Pages | Do not assume available | Requires appropriate Enterprise Cloud setup | Visibility guard fixtures; no deployment |
| Exact specialist cloud tokens/cost | Not guaranteed | Not guaranteed; org totals are not specialist totals | Null/provenance handling and interactive report |

Run `crewbie doctor --repo owner/name --agent crewbie-developer --model MODEL`
for read-only discovery. It does not prove live assignment, model selection, or
memory use. Keep those limitations visible when evaluating an account.

The 2026-09-22 live smoke test used one cloud task in a private synthetic repository.
The completed task reported the selected specialist and one session. Its PR
included unique tags present only in the charter, hot memory and active cold
topic, and its implementation passed four tests locally and on hosted Linux.
These tags are read evidence, not proof of the model's internal reasoning.
That first smoke test did not exercise the rest of the team or nightly learning.
The subsequent team test ran the local coordinator, three named native cloud
specialists (implementation, testing and review), and the hosted improver.
Specialist PRs changed their own bounded history; the implementation PR also
proposed a shared decision. The reviewer ran both branches and identified a real
reporting gap. The three-job improvement workflow published its own four-line
hot-memory proposal with built-in tokens, and a second run skipped AI/publication
when no evidence changed. All learning proposals remained unmerged.

The test verified two execution slots, completed-session release for explicit
review tasks, and a blocked implementation merge-gate probe that never acquired
a launch claim. Organization entitlement, ADO and Pages remain unverified live.

The later Java/React run used a realistic inventory/order application, then normal
onboarding without context canaries or forced learning. An initial tester session
timed out and its failed verification was retained. The bounded review loop
published actual GitHub reviews, routed two rounds of frontend corrections to the
original named specialist, refreshed tester evidence and ended with clean reviews
on the exact final heads. Independent combined verification passed focused Java
checks, 17 frontend checks, the build and five real-browser journeys. Regression
probes also confirmed that observer-triggered retries stop after a page error and
that valid empty beyond-end pages remain accepted.

GitHub regenerated or retained stale PR descriptions during these sessions.
Verified attribution and closing links are maintained by reconciliation; the
local coordinator used guarded description finalization for concise, current
handoffs. The hosted improver proposed a small guard against inferring policy from
incomplete evidence, and the private dashboard workflow succeeded. These are
account-specific alpha results, not a claim of universal or unattended production
readiness. Application and learning PRs remained unmerged.

## Evolving the team

The approved configuration is the current roster, not a permanent template.
`init` on an installed repository and `init --update --out team-review.json`
reassess the current project without resetting its models, approvers, limits,
constitution, integrations or learning permissions.

The `team` report separates evidence-backed suggestions from existing roles that
need human review. Discovery uses non-ignored production paths and bounded
manifest inspection: at most 20 manifests, 64 KB each and 512 KB total. Omitted
or malformed manifests are disclosed. Fixture, example and generated paths do
not automatically grow the team. No project script is executed.

Built-in signals are not a role enum. The coordinator must also consider the
feature's domain and can propose custom roles, splits, specialization or
retirement. Review proposed purpose, checks, non-negotiables and models before
applying. Newly detected roles have no approved model until you choose one.
Existing roles and their domain guidance remain intact unless explicitly edited.

Reassessment proposals bind to the existing configuration fingerprint. A stale
proposal cannot overwrite intervening policy changes; LF/CRLF checkout differences
are tolerated. Installation retains historical profile and memory files when a
role is explicitly removed from the active config. Crewbie stops routing new
work to that role, but never reassigns existing tasks automatically. Review/drain
open work and reapprove any changed task ownership before retiring a role.
New roles do not silently expand nightly instruction-edit permissions.

## Ready-label issue intake

The label **`crewbie:ready-for-planning`** is separate from the execution-state
label `crewbie:ready`. It authorizes coordinator planning, not application work.
Enable it in a reviewed setup proposal:

```json
{
  "planning": {
    "enabled": true,
    "model": "gpt-5.4"
  }
}
```

This is the `config.planning` fragment, not a complete setup file. Choose a model
your account supports; the example is not an entitlement guarantee. Apply the
reviewed proposal and commit the generated configuration, profiles, memory and
`crewbie-plan.yml` workflow to the default branch.

Configure `CREWBIE_PACKAGE` as described above, set an approved exact
`CREWBIE_COPILOT_VERSION` (the earlier hosted CLI runs used `1.0.87`), and allow
Actions to create pull requests. Copilot billing/organization policy still
applies. No saved user token is required for planning:

```powershell
gh label create "crewbie:ready-for-planning" --repo OWNER/REPO --color b11f4b --description "Approved for coordinator planning, not implementation"
gh variable set CREWBIE_COPILOT_VERSION --repo OWNER/REPO --body "1.0.87"
```

Put the PRD in the issue body, then have a configured human approver apply the
label. The workflow checks the actual label-event actor and current issue
content before analysis. Bots, unapproved actors, closed issues, generated
execution issues and unrelated labels cannot start planning. Creating an issue
alone is not a trigger. After source changes, review the text and remove/reapply
the label; it does not continuously analyze every edit.

The prepare job uses read-only repository access and loads the coordinator
charter, bounded hot/index memory, relevant indexed history, shared guidance and
the repository assessment. The separate model job has Copilot-request permission
but no repository write permission or available tools. This is a named-context
Copilot CLI planning run in Actions, not a native Agent Tasks implementation
session. Model selection is requested explicitly; runtime model/billing
measurements are not inferred.

The publisher rechecks the source, label approval, policy and default-branch
revision. It creates a draft PR with `.crewbie/plans/issue-N/` files: a concise
human-facing plan, a setup proposal and an unapproved task batch when requirements
are sufficient. Merge-enabled plans also include the actual reviewed team files
and an execution manifest, as described below. Each task names an owner, model and dependencies.
Custom specialists need domain checks and non-negotiables. Missing requirements
produce questions rather than fabricated acceptance criteria.

With merge execution disabled, review the proposal on its branch. Preview and apply `setup.json` through `init`,
then review/merge the resulting configuration and profiles onto the default
branch. Resolve questions and inspect `batch.json` before `approve --batch ...
--yes --execute` and `publish --batch ... --apply --dispatch-local --watch`.
In this manual mode, merging the draft planning PR alone neither installs its
nested setup proposal nor approves execution. The coordinator never approves
its own task graph.

The same source/base/configuration snapshot is deduplicated, including a closed
planning PR. Existing branches without a matching PR indicate interrupted
publication and stop visibly; inspect them rather than deleting state or blindly
retrying. Changed source or base context requires a fresh reviewed label event.
Planning never force-pushes a human-edited branch or merges PRs.

Inputs are bounded to a 50 KB issue body and 100 KB total prompt/output. Plans
have at most eight tasks, five questions and four additional roles per proposal.
The three jobs have 3/9/3-minute limits; different issues can plan concurrently.
These limits are not spending caps. Links, attachments, Word/PDF files and
external URLs are **not fetched**: paste the relevant text into the issue.
Generated task issues are explicitly excluded, preventing recursive planning.

### Approve and merge to execute

For a GitHub-only per-feature handoff, also set `config.planning.executeOnMerge`
to `true` in the reviewed setup. Install the updated workflows once and commit
them to the default branch. Configure `CREWBIE_USER_TOKEN` in repository Actions
secrets using a supported user-authorized credential belonging to a configured
approver. It needs the documented native-assignment access, issue publication,
claim-ref writes and workflow-dispatch permissions. Follow the linked GitHub
permission guidance rather than assuming an installation token can assign agents.
Store credentials through the approved secret store, never issues or commits.
Enable `crewbie-execute-plan.yml` and `crewbie-dispatch.yml` if previously disabled.
The built-in job token is sufficient for planning, **not native assignment**.

For subsequent features, your only handoff is to review the planning PR, approve
its exact final commit, and merge it into the default branch. Ready plans include:

- The concise spec and task batch.
- Actual configuration, changed/new specialist charters and missing new-role
  hot/index seeds. Existing history and unchanged human-customized charters stay intact.
- A bounded execution manifest identifying the planning run and reviewed files.

The planning PR may change roles, not approvers, concurrency, workflow permissions,
secrets or unrelated policy. It includes no application changes. Clarification-only
plans do not contain an executable manifest and cannot start work when merged.
If a generated plan needs edits, regenerate it and review the new commit; changing
files without refreshing its fingerprints blocks execution rather than accepting
an ambiguous plan.

The merged-PR workflow runs trusted package code from the default branch, never
untrusted PR-head code with assignment credentials. It independently verifies:

- Prior opt-in policy from the recorded default-branch planning workflow run,
  which must have completed successfully.
- A configured human's `APPROVED` review on the exact final head before merge,
  and a configured human merger. Stale/bot/dismissed approvals and unresolved
  human change requests do not qualify.
- The complete allowed file set, unchanged contents across reviewed head, merge
  commit and current default branch, and the unchanged source-issue requirements.

After authorization, it publishes task issues with specialist/model ownership,
records their planning-PR approval provenance and explicitly requests the normal
dispatcher. No local `init`, `approve` or `publish` command is needed for that
feature. Shared locking and persistent launch claims retain concurrency and
duplicate-launch protections. The dispatcher reconciles on configured issue/PR
events and its hourly recovery schedule; GitHub can delay scheduled runs. Implementation
dependencies still require merged application PRs; independent work and explicit
review tasks progress under their existing rules. Application PRs are never
automatically merged.

Missing credentials, changed policy, lost planning-run evidence, changed files
or failed publication stop visibly. For recovery, use **Run workflow** on
`Crewbie execute approved plan` with the merged planning PR number. All approval
checks run again; matching issues and approvals are reused. Do not erase launch
claims or overwrite branches to force another paid session. Keep the planning
run record until execution/recovery finishes. A merge by an unconfigured bot or
merge-queue identity does not substitute for the required human merger.

## ADO-authoritative work

Configure `ado` with `organization`, `project`, and `workItemType`.

```powershell
crewbie status --ado-id 123
```

Preserve the returned URI, revision, and content fingerprint in `batch.sources`.
Use a task's optional `adoWorkItem` to link an existing item. Add `--ado-create`
to a reviewed `publish --apply` command to create missing ADO items instead.
The preview identifies that choice.

ADO creation uses a deterministic tag to recover a mapping after partial
failure. Source material changes stop publication/dispatch for reconciliation.
Fingerprints distinguish material changes from bookkeeping-only revisions.
An existing item is never silently rewritten to fit a changed batch.

GitHub issues/PRs and brief status comments are written back idempotently.
No ADO state transition, description replacement, or two-way acceptance-criteria
sync occurs. A failure after GitHub writes is a partial operation, not a rollback:
re-run after inspection to reuse existing issue/tag mappings. Verify uncertain
ADO creation outcomes before retrying because server-side indexing can lag.

## Instruction quality: evidence and limits

The read-only assessment cites
[Gloaguen et al., *Evaluating AGENTS.md*](https://arxiv.org/abs/2602.11988).
In the studied Python repositories and agent/model configurations, generated
context did not reliably improve success and increased inference cost (section
4.2). Appendix B reports no clear dependency of success/cost on context-file
length; it also finds generated context useful when other documentation is
removed. These are study-specific observations, not a universal instruction ban.

Crewbie's documentation/profile overlap, generic-advice, unverified-link,
npm-script and unconditional full-suite signals are **engineering heuristics**,
not validated causal rules from the paper. They identify concrete material for
human review. Necessary standalone context and explicit merge/compliance gates
should be retained. Contradictions, domain relevance and actual benefit still
need semantic review and representative before/after task evidence.

The scanner reads visible non-ignored instruction files, README/CONTRIBUTING
documents and package manifests. It checks at most 32 instruction files, 12
reference documents and 20 manifests, with 64 KB per file and 512 KB total;
omissions are reported. Root guidance is prioritized before specialist profiles.
At most twelve signal details are shown; `signalsOmitted` reports the remaining
detected warnings rather than silently presenting the sample as complete.
These are inspection resource limits, **not quality thresholds**. No project
script or linked URL is executed. The existing configurable charter/spec word
budgets remain readability constraints, not research-derived quality scores.

## Scheduling and recovery

### Autonomous review and correction

`publish --review-loop FILE --apply --watch` explicitly authorizes a bounded
review/correction workflow. It is a separate approval from the initial task
graph: it can review saved failing QA evidence rather than pretending a failed
session completed. Requirements, target ownership/model and existing issue
approval must still match. Final merges remain human-controlled.

The plan shape is:

```json
{
  "schemaVersion": 1,
  "reviewer": { "issue": 5, "issueDigest": "<exact issueDigest>" },
  "targets": [
    {
      "issue": 3,
      "pr": 7,
      "issueDigest": "<exact issueDigest>",
      "allowedPaths": ["frontend/src/", ".crewbie/team/frontend/"]
    }
  ],
  "maxRounds": 2
}
```

Compute each digest with the same exported `issueDigest(title, body)` used for
issue approval: SHA-256 of `JSON.stringify({title, body})`. Changing target scope,
paths or the budget creates a new plan; inspect any old running loop before
starting it. Paths ending in `/` authorize that subtree. Workflow, Git and
general Crewbie policy roots are excluded.

The reviewer commits a small machine-readable report to its own unmerged PR.
The coordinator validates exact target heads, findings, scope and native
profile/model evidence before publishing GitHub `COMMENT` reviews. The review
body names `crewbie-reviewer`, its native task, report PR and verdict. GitHub's
posting identity is the authorized coordinator account, not a fabricated agent
account. A clean automated review does not count as human approval.

Corrections use the documented Agent Tasks `base_ref`/`head_ref` continuation,
with the same approved specialist/model. State lives on the isolated
`crewbie/review-state/<digest>` branch, not in hot memory or on the application
default branch. Launch intent is persisted before a paid request. Unknown
outcomes are never automatically repeated. Immutable approver-authored receipts
let ordinary reconciliation recognize an explicit chain of native tasks on one
PR; extra or concurrent unrecorded tasks remain ambiguous.

When the plan includes a tester target, completed implementation corrections
automatically trigger that specialist to refresh combined-head evidence before
re-review. Missing tester evidence does not suppress independently actionable
implementation findings. This authorizes verification within the original test
scope, not a weaker assertion or a broader application change.

The shared dispatch lock, repository-wide native task count and unresolved
assignment reservations limit concurrency. Continuations update the same
running/review/failed issue labels as initial dispatch.
Each correction round receives a fresh independent review. Required findings
remaining after the budget, scope changes, unverified models, cloud failures or
missing evidence stop visibly. Resume the exact plan after inspecting the cause.
Do not erase launch intent or claims to force a retry.

### Initial task graph

Owner/status labels describe the approved task; prerequisite IDs remain the
source of truth. Polling recovers missed GitHub events. Bot-applied labels are
not assumed to trigger another workflow, so publication also dispatches it.
Issue/PR attribution uses GitHub's authoritative closing references, not ordinary
timeline mentions. A review PR can discuss another task without becoming that
task's implementation PR or releasing its dependencies.

With `publish --dispatch-local`, orchestration is one-shot: re-run publication
with the same approved batch to release newly ready work. Existing claims prevent
duplicate sessions; approval does not need to be repeated when the batch is
unchanged. This mode does not require an always-on local scheduler.

Add `--watch` for a bounded foreground reconciliation loop using the same local
credentials. `--poll-seconds` defaults to 30 and `--timeout-seconds` to 3600.
The exact published batch and approval are checked before each dispatch. Other
batches count toward capacity but are not launched by this command. Changed scope,
missing approval and API failures stop the loop; uncertain sessions retain their
claims. It does not bypass GitHub workflow-approval policy.
Local publication carries its confirmed issue IDs into reconciliation. Missing
entries in GitHub's freshly updated label index are fetched directly; their
contents and human approval are still checked before any launch.
Transient HTTP 502/503/504 reads (GET and explicit GraphQL queries) receive at most
two retries with bounded backoff. A Retry-After longer than 30 seconds stops
instead of retrying too early. Assignment, lock writes/deletes and mutations are
never retried automatically: their outcomes may be ambiguous.

The loop exits successfully when all selected tasks have completed cloud sessions
with linked PRs, or merged PRs. This is a handoff, not a passing-check or review
verdict. Human merge gates and failed work stop with exit code 2, as does timeout.
Timeout is checked between reconciliations; in-flight API calls retain their
normal request timeout. Stopping the watcher does not cancel remote sessions.
Resume with the same approved command after inspecting the reported condition.

The dispatcher obtains an atomic `crewbie/dispatch-lock` Git tag, and a
`crewbie/claims/<issue-number>` tag before each assignment. These hold no
transcripts or secrets. Claims deliberately survive unknown network outcomes;
repeated runs do not blindly start another paid session. Claims also identify
already-running work when a workflow restarts.

These operational tags produce GitHub push events. Limit application/setup
workflows to their intended branches, or exclude `crewbie/**` from tag triggers.
GitHub does not evaluate path filters for tag pushes: a workflow with only
`push.paths` can otherwise run on every lock update. Keep release-tag workflows
scoped to their release namespace.

If a runner dies while holding the dispatcher lock, an administrator must
confirm no dispatch is active and remove only that reserved lock ref.
For a stalled issue, inspect its Copilot session and linked PR before any retry.
Only after confirming there is no active session may an administrator remove
that issue's specific claim and reapprove the task as needed. Never bulk-delete
claims or treat issue closure as successful implementation.

Reconciliation preserves unrelated labels. Failed/unmerged work blocks its
descendants. Claims survive session completion to prevent relaunch. A uniquely
correlated completed cloud task frees execution capacity while its PR awaits
review; it does not satisfy a merged-PR dependency. Missing, ambiguous, active or
inaccessible task telemetry retains capacity and reports why. A draft PR alone
is not proof that a session has finished.
An explicitly approved `kind: "review"` task can depend on completed sessions
with linked PRs; default implementation tasks still require merged prerequisites.
Changing a task's kind invalidates its approval like other scope changes.

## Nightly learning and bounded history

Set `nightly.enabled` to true in a reviewed setup proposal and install it.
The enabled workflow defaults to 02:37 UTC; GitHub schedules can be delayed. Disabled
installations have only a manual maintenance trigger, not a nightly cron. The input
cap defaults to 20 new records; preparation, analysis and publication have 3/9/3
minute timeouts (15 minutes of job execution in total). Neither is a
guaranteed monetary ceiling.

Only `nightly.allowedPaths` can be proposed. Broader access to an existing
constitution, `AGENTS.md`, or scoped instructions requires explicit configuration.
The analysis receives bounded snapshots and has no available tools or GitHub
write credential. A separate deterministic step checks paths, hashes, evidence,
word limits and obvious secret patterns before publishing; human review remains
essential.

Specialists close each task by assessing learning. Approved memory paths can be
changed on the work branch for human review; existing accepted policy is preserved.
New shared decisions remain explicitly proposed until approved. Out-of-scope
lessons go in one PR comment starting with `<!-- crewbie-memory-proposal -->`,
with target path, lesson, reason and evidence. The collector includes bounded
proposals from the Copilot bot or configured approvers in nightly input. It does
not promote comments to policy or force memory changes for routine work.

Own hot/index history and shared decisions are included. Human-closed improvement
PRs become feedback; the agent's own open-PR bookkeeping is not fresh evidence.
Affected specialists' hot/index files and charters are included with
LF-normalized text hashes, so Git's LF/CRLF conversion does not create false
conflicts. Installer ownership and proposal validation use the same normalization
and accept legacy LF/CRLF fingerprints; real content edits still stop updates.
Approval/source digests and explicit instruction-adoption hashes remain unchanged.
Up to five
relevant cold/archive links per role are selected by index-label keyword matches.
Unrelated history stays unloaded; missing context is a reason to defer a change,
not to invent it. Shared links can use `../../decisions/cold/topic.md` from a
role index, or `decisions/cold/topic.md` from the shared decisions file.
Operational cursors live on the orphan `crewbie/runtime` branch, separately from
human-facing memory. It records the latest reviewed fingerprint/outcome per work
item, so no-change analysis can advance without opening a pointless PR.

The reserved proposal branch is `crewbie/improvements`. Concurrent file changes,
a branch behind its base, or a leftover closed proposal branch stop updates for
human reconciliation rather than force-pushing over work. Merge, close and
curate the active proposal when its combined description exceeds the readability
budget. After reviewing a closed proposal, remove its reserved branch before
creating another; accepted/rejected evidence remains in PR history and the cursor.

Cold/archive topics are loaded explicitly through the index, not all at once.
The `limits` configuration can record deliberate word-budget exceptions:
`spec`, `charter`, `hot`, `index`, `decisions`, `constitution`, `topic`, and `pr`.
There is no silent truncation. Oversized external PR feedback is explicitly
omitted with a source link, not partially presented as a complete summary.

The report workflow also checks Copilot PR wording using trusted default-branch
code: short What changed, Why and Checks sections, normally no more than 250 words.
This checks structure and length, not whether a claimed test actually ran. Human
review still evaluates rationale and evidence.

Installation proposes a short PR template only when no existing template is
found in GitHub's supported repository locations. Existing templates are preserved.
The live agent's original PR description omitted explicit rationale/check sections,
despite using the correct profile. The check caught this; the example was corrected
manually, and template support plus explicit heading guidance were added. Another
paid cloud run has not been used to establish whether that guidance reliably
controls GitHub's generated summaries.

The team test confirmed that a specialist can produce a correctly structured
final handoff while GitHub independently generates a different PR body. Treat
persisted PR metadata as a coordinator finalization step, not proof of what the
specialist reported. Inspect the native session handoff (for example,
`gh agent-task view SESSION_ID --repo owner/repo --log`) and actual CI.
Use `publish --pr N --proposal handoff.json` to preview a concise correction;
`--apply` requires a configured human approver and matching `headSha`/`beforeHash`.
The proposal's `body` must pass the normal format/length check. This changes only
PR metadata, not code, approvals or merge state, and avoids another paid
implementation run merely to repair prose.

Cloud hosts inject the active charter and may protect its file path from agent
tools. Record injection separately from file-read attestations; respect those
restrictions. Native Copilot Memory is a separate platform feature, not Crewbie's
reviewed role history or approval of proposed shared decisions.

## Reports and privacy

The report workflow uploads an Actions artifact. That requires repository access
to download; it is not an in-browser hosted site. Check repository and artifact
retention settings before treating it as a historical ledger.

To use Pages, configure the site and explicitly set `CREWBIE_PAGES_MODE`.
The publishing job checks the actual Pages `public` flag and fails closed on a
mismatch. A private source repository alone does not make a Pages site private.
Public Pages requires an explicit administrator choice even for open-source code.

Imported records must include evidence for non-null usage/observed-model fields.
Token counts, credits and currency are separate measurements. Example records
are synthetic, not real billing. The report escapes all data and works without
external scripts, fonts, network access or storage.

## Verification and release

`npm test` builds strict TypeScript and exercises CLI installation/approval,
request contracts, dependencies, retry claims, memory, ADO, maintenance safety,
workflow YAML, and the dashboard's interactive DOM. CI is configured for current
Node 22 on Windows, macOS and Linux.

Before broader release, run a consenting personal/organization account matrix:
select the actual profile/model, inspect memory-read attestations and issue/PR
linkage, exercise maintenance authentication, and confirm private publishing.
No live test is implied by a fixture passing. Registry publishing, trademark
clearance, and paid cloud runs require the project owner's separate decision.
