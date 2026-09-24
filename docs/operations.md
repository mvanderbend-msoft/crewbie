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

For a repository-restricted fine-grained PAT, issue assignment requires Metadata
read and Actions, Contents, Issues and Pull requests read/write. Crewbie also
needs **Agent tasks: read** to correlate sessions and release completed capacity;
assignment permissions alone do not grant telemetry access. The optional
same-PR correction loop needs **Agent tasks: read/write**. See GitHub's
[Agent Tasks permissions](https://docs.github.com/en/rest/agent-tasks/agent-tasks).
Unavailable telemetry keeps capacity reserved rather than guessing completion.

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
| Variable `CREWBIE_PACKAGE` | Optional approved pinned package override; defaults to the exact version that generated the workflows |
| Variable `CREWBIE_COPILOT_VERSION` | An approved exact Copilot CLI package version |
| Variable `CREWBIE_MAINTENANCE_MODEL` | Explicit approved maintenance model; not `auto` |
| Variable `CREWBIE_PAGES_MODE` | Leave unset for artifact-only reports; opt into `private` or `public` |
| Config `planning.enabled` / `planning.model` | Opt into ready-label coordinator planning with an explicit model |
| Config `planning.executeOnMerge` | Opt into paid task execution after a verified human approval and merge |

Generated workflows embed the exact installed version's GitHub release tarball
URL. A missing
`CREWBIE_PACKAGE` variable no longer blocks ready-label dispatch. The embedded
version must have its package asset attached to its GitHub release; no npm
registry publication is required. For an unpublished/custom build, distribute an
approved tarball and override the package source:

```powershell
gh variable set CREWBIE_PACKAGE --repo OWNER/REPO --body "https://YOUR-RELEASE-HOST/crewbie-cli-VERSION.tgz"
```

Installing the package uses `--ignore-scripts`; the packed `dist` is prebuilt and
its JSONC parser is installed by npm. Keep credentials out of package URLs.
Existing repositories need to reapply reviewed setup with the new CLI and commit
the changed workflows; upgrading a local package alone cannot change hosted YAML.

The nightly analysis job grants only `copilot-requests: write` and uses a recent,
pinned CLI with the built-in token. Personal repositories bill the owner's Copilot
seat; organization repositories require the Copilot CLI organization-billing
policy. See [Copilot CLI Actions authentication](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/copilot-cli-in-github-actions).
The separate publisher needs `contents: write`, `pull-requests: write`, and the
repository setting allowing Actions to create PRs. It never approves or merges a
PR. A missing entitlement or permission is an error, not a token/runtime fallback.

## npm publishing

`package.json` declares a public scoped package with a `crewbie` binary.
`npm pack` builds and includes `dist`, docs, examples and the license. Installing
the package does not run setup, create labels, or start agents.

GitHub releases run the package-artifact job, which uploads the npm-installable
tarball and `SHA256SUMS`. npm registry publication is **disabled by default**:
the separate publish job requires the repository Actions variable
`CREWBIE_NPM_PUBLISH_ENABLED` to equal `true`. Leave it unset while npm account
setup is deferred.

Before the first publication, the maintainer must have an npm account with 2FA
and publish permission under `@crewbie`. If available, create the `crewbie`
organization through the npm profile menu's **Add an Organization**, selecting
the free **Unlimited public packages** plan. If another party owns the scope,
obtain permission or explicitly choose a different package name.

Run `npm login --auth-type=web --registry=https://registry.npmjs.org` and complete
authentication directly with npm. `npm whoami --registry=https://registry.npmjs.org`
checks the authenticated account; it does not prove namespace permission.
Keep credentials and recovery codes out of Git and chat. A registry TLS failure
requires approved network/proxy/CA configuration, not `strict-ssl=false`.

Review the package contents with `npm pack --dry-run`, then bootstrap with
`npm publish --access public --tag next`. Complete any 2FA challenge directly
with npm. Verify the published version using
`npm view @crewbie/cli@0.1.0-alpha.12 version --registry=https://registry.npmjs.org`.

After the package exists, open its npm **Settings > Trusted publishing**, choose
GitHub Actions, and configure:

| Field | Value |
|---|---|
| Organization or user | `mvanderbend-msoft` |
| Repository | `crewbie` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |

Configure the `npm` GitHub environment's release approvals and commit the
workflow before creating a release. After trusted publishing is ready, explicitly
enable `CREWBIE_NPM_PUBLISH_ENABLED=true`. No long-lived npm token is needed in
GitHub secrets. Publishing a GitHub release then runs the checks, verifies
the release tag matches `package.json`, and publishes with provenance using OIDC.
Prereleases use `next`; stable releases use `latest`. Merely changing this
repository does not publish a package or configure the npm account.

## Account and runtime capability matrix

| Capability | Personal repository | Organization repository | Verified here |
|---|---|---|---|
| Local onboarding/task decomposition | Supported | Supported | Local CLI and fixtures; LLM response handling uses deterministic fixtures |
| Ready-label issue planning | Opt-in Actions CLI; eligible Copilot seat | Opt-in Actions CLI; organization billing policy | Live private Java/React intake passed prepare/analyze/publish with the coordinator charter/history, proposing five tasks across four specialists |
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

The ready-label trial exposed two separate permission requirements: planning
preparation/publication need `actions: read` to verify their run provenance, and
the user credential needs Agent tasks read access to reconcile native sessions.
After both were corrected, hosted planning published a reviewable PR and hosted
dispatch verified all four historical completed sessions without deleting claims.
The planning PR remains subject to human approval and merge; that result alone
does not establish live merge-triggered assignment.

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

Onboarding prefers adopting existing frontend, backend, testing and review
specialists rather than replacing their ownership with invented combined roles.
Each eligible original gets an explicit adopt/retain decision and rationale.
`maxActive` is a concurrency limit, not a roster-size target.

An adopted role records `sourceAgent` in configuration. Its original moves from
`.github/agents/NAME.agent.md` to
`.crewbie/agent-archive/github/agents/NAME.agent.md` (or the corresponding `claude`
archive). The new active profile is `.github/agents/crewbie-ROLE.agent.md`.
The archive preserves the complete original bytes as backup provenance. The active
profile embeds the complete original instruction body, retains the description,
persona and frontmatter tool restrictions, and adds Crewbie memory, identity and
handoff rules. The archive is not a substitute for the active instructions.
Known adopted-agent handoffs are
retargeted. The selected model governs the active profile. Unsupported tool
metadata requires manual review rather than silently widening permissions.
Charters have no word budget. The whole active prompt (preserved body plus Crewbie
additions) must fit GitHub's documented 30,000-character custom agent maximum. If
it does not, init stops before adoption and asks the user to shorten the original;
it never truncates instructions. Available from alpha.12; earlier releases stopped at 400 words.

Archival requires the exact inspected source hash, rejects conflicting archives
or edited originals, and is idempotent. Archives are written before originals
are removed. Installation previews name both actions. Adding these adoptions is
an init operation, not a planning PR's authority to retire original agents.

The approved configuration is the current roster, not a permanent template.
`init` on an installed repository and `init --update --model MODEL --out team-review.json`
reassess the current project without resetting its models, approvers, limits,
constitution, integrations or learning permissions.

The `review` report contains the LLM assessment; `team` contains static hints,
not a final roster. Discovery uses non-ignored production paths and bounded
manifest inspection: at most 20 manifests, 64 KB each and 512 KB total. Omitted
or malformed manifests are disclosed. Fixture, example and generated paths do
not automatically grow the team. No project script is executed.

Built-in signals are not a role enum. The coordinator must also consider the
feature's domain and can propose custom roles, splits, specialization or
retirement. Review proposed purpose, checks, non-negotiables and models before
applying. New roles use the explicitly selected init model, subject to setup review.
Existing roles and their domain guidance remain intact unless explicitly edited.

Init writes a readable Markdown assessment next to its setup JSON. The terminal
keeps the overview short; the report contains detailed findings, adoption
decisions, coverage limits and concrete replacement text for guidance edits.
Advisory recommendations and unresolved policy decisions are not executable
changes. If `instructions` is empty and no constitution is proposed, choosing
guidance application cannot modify existing instruction files; init states this
explicitly. Skipping guidance preserves those proposals for later review.

Interactive terminals use arrow-key selectors for models and **Team / All / Save**,
with Save selected by default. Hosted planning and final installation have separate
confirmations defaulting to no. Ctrl+C cancels; a proposal already saved remains
available. Noninteractive automation keeps the existing explicit model, proposal,
apply and guidance flags; it never waits for a selection menu. Previews group
creation, updates and archival separately.

These selector and active-charter preservation changes, along with the stricter
review below, are available from alpha.11.

The shared CLI presentation layer also formats other commands: grouped help,
command headings, status-coloured tables, stacked nested records and separated
errors. It wraps to terminal width (up to 120 columns), measures Unicode display
width and falls back to stacked fields when a table would be too narrow.
`NO_COLOR`, `FORCE_COLOR=0` and `TERM=dumb` disable colours without removing the
readable layout. Redirected streams retain their previous output shapes; supported
`--json` views skip terminal decoration. Internal workflow commands remain plain,
including their unchanged Actions summaries and output files. No formatter changes
approval, execution or exit-code semantics.
Use `init --proposal FILE --json` for the machine-readable installation preview.

Init includes every inventoried instruction, custom-agent and MCP configuration
path in its assessment. Text inspection has a 256 KB total/64 KB per-file budget
and representative implementation sampling. Omissions are explicit, not a claim
of complete semantic coverage. MCP JSON/JSONC files expose only server names,
transport, executable basename and environment-variable names; values, arguments,
headers and URLs are withheld. Servers are not started or connectivity-tested.
Personal/global and ignored settings are not read. MCP configuration changes
remain recommendations for manual review, not automatic credential-bearing edits.

Interactive init discovers the account's enabled model catalogue through the
official Copilot SDK and presents numbered choices with IDs and available billing
multipliers. Invalid selections reprompt; `q` cancels. Discovery failure stops
with an error rather than inventing model choices. An explicit `--model MODEL`
skips the assessment picker. New roles default to cost-aware choices from the
account catalog, with reported token prices/capabilities and a reviewed complexity
rationale. Installed choices are preserved. `--model-policy fixed` or
`--specialist-model MODEL` skips specialist discovery and uses an explicit override;
the account still needs entitlement. Legacy multipliers are not token prices.

The LLM runs through the SDK's bundled runtime over shell-free stdio, tool-free
in a temporary working directory and isolated `COPILOT_HOME`, using environment
credentials or authenticated GitHub CLI. Runtime configuration discovery, skills,
file hooks, git context and shared session storage are disabled; tool permissions
are denied. Init waits for a completed assistant response rather than parsing
process stdout. Startup/model discovery have 30-second timeouts and assessment
has a five-minute timeout. Empty or malformed JSON produces an explicit error;
check authentication/model access for runtime errors, or retry/narrow the context
for incomplete output.
While waiting, init reports elapsed time every 15 seconds and announces validation
when the response arrives. This heartbeat does not claim token-level progress or
predict completion time.

`contextPaths` is a reusable-guidance list, not a list of implementation targets.
The prompt and validator share the eligible inspected, unredacted Markdown paths.
Spaces in document names and `.MD` extensions are supported. Onboarding normalizes
Windows separators and leading `./` only when the result matches an eligible
file; traversal, absolute paths, source files, globs and uninspected links remain
rejected. Errors identify the specialist and invalid paths.

Interactive init can repair those links in the existing response: choose numbered
replacement documents, `none` to explicitly remove only the rejected links, or
`cancel`. Already-valid links remain. This does not invoke the model again; the
whole proposal still passes validation and human review before installation.
Noninteractive runs fail explicitly on invalid links rather than guessing fixes.

No fallback roster is installed if analysis fails. `--assessment-only` keeps the
offline inventory path explicit. Greenfield setup requires a description or
requirements in the repository; interactive clarification repeats, while
noninteractive runs persist questions and stop without installing a team.

`init --proposal FILE --apply --guidance skip` installs the team without proposed
guidance changes; `--guidance apply` includes them. Both create all workflow and
owner labels. Existing labels are preserved; retries add only missing labels.
Label failure reports that local setup succeeded and remote setup is incomplete.
Rerun the same command to repair it. Use `--skip-labels` only for deliberate
offline setup; rerun without it before hosted intake.

Reassessment proposals bind to the existing configuration fingerprint. A stale
proposal cannot overwrite intervening policy changes; LF/CRLF checkout differences
are tolerated. Installation retains historical profile and memory files when a
role is explicitly removed from the active config. Crewbie stops routing new
work to that role, but never reassigns existing tasks automatically. Review/drain
open work and reapprove any changed task ownership before retiring a role.
New roles do not silently expand nightly instruction-edit permissions.

## Ready-label issue intake

Interactive init asks for explicit hosted-planning opt-in. Existing enabled
planning settings are preserved; automatic execution on merge is not enabled by
this prompt. Commit both the approved configuration and regenerated planning
workflow before using the label.

**A successful dispatch run is not evidence that an agent started.** Dispatch
reconciles published managed implementation tasks, while
`crewbie:ready-for-planning` belongs to the separate planning workflow. With no
managed tasks, dispatch reports that no agents started and explains whether
planning is enabled, in both logs and the Actions job summary. If planning is
disabled, explicitly enable it through reviewed init, commit the resulting setup,
then remove/reapply the ready-for-planning label to request planning. Do not add
managed labels or bypass human execution approval to force a launch.

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

`crewbie update` previews repository integration changes without AI reassessment;
`crewbie update --apply` applies them and refreshes an existing `CREWBIE_PACKAGE`
override to the installed CLI release. Upgrade the CLI separately with npm.
Commit the generated file changes. Edited managed files block application; resolve
the listed conflicts rather than changing ownership hashes blindly. `--offline`
leaves remote variables unchecked. Existing execution opt-outs and models remain
unchanged.

Set an approved exact
`CREWBIE_COPILOT_VERSION` (the earlier hosted CLI runs used `1.0.87`), and allow
Actions to create pull requests. Copilot billing/organization policy still
applies. No saved user token is required for planning:

```powershell
gh variable set CREWBIE_COPILOT_VERSION --repo OWNER/REPO --body "1.0.87"
```

Init creates the ready-for-planning label with the other workflow labels.
Put the user-authored PRD/spec in the issue body, then have a configured human approver apply the
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
revision. It creates a non-draft PR with `.crewbie/plans/<feature>-issue-N/` files: a concise
human-facing plan, a setup proposal and an unapproved task batch when requirements
are sufficient. Merge-enabled plans also include the actual reviewed team files
and an execution manifest, as described below. Each task names an owner, model and dependencies.
Custom specialists need domain checks and non-negotiables. Missing requirements
produce questions rather than fabricated acceptance criteria; those PRs remain drafts.
Non-draft means ready for review, not permission to bypass branch protection.
Already-generated legacy `issue-N` directories remain executable.
Crewbie does not create PRDs/specs. The legacy batch `spec` field remains for
compatibility and holds a deterministic source reference in hosted plans;
model-authored specification text is discarded. The constitution remains in use.

With merge execution disabled, review the proposal on its branch. Preview and apply `setup.json` through `init`,
then review/merge the resulting configuration and profiles onto the default
branch. Resolve questions and inspect `batch.json` before `approve --batch ...
--yes --execute` and `publish --batch ... --apply --dispatch-local --watch`.
In this manual mode, merging the planning PR alone neither installs its
nested setup proposal nor approves execution. The coordinator never approves
its own task graph.

The same source/base/configuration snapshot is deduplicated, including a closed
planning PR. Existing branches without a matching PR indicate interrupted
publication and stop visibly; inspect them rather than deleting state or blindly
retrying. For an open plan, use `crewbie revise-plan --pr N --feedback-file feedback.txt`
to preview a same-PR revision and repeat with `--apply` to request one paid run.
The workflow accepts an explicit human request, reuses prior setup/plan/batch
context, skips the full assessment and regenerates the execution manifest.
Only configured approvers may request it. It checks source, policy, base ancestry
and the exact prior head, and advances the branch without force. Previous approvals
are stale after revision. Update a behind planning branch before requesting work;
close/relabel is not needed for ordinary plan feedback. Re-running an already
published revision skips further analysis. If publication is interrupted, inspect
the existing branch and metadata before another paid request.
Planning never merges PRs.

Inputs are bounded to a 50 KB issue body and 100 KB total prompt/output. Plans
have at most eight tasks, five questions and four additional roles per proposal.
The three jobs have 3/9/3-minute limits; different issues can plan concurrently.
These limits are not spending caps. Links, attachments, Word/PDF files and
external URLs are **not fetched**: paste the relevant text into the issue.
Generated task issues are explicitly excluded, preventing recursive planning.

### Approve and merge to execute

For a GitHub-only per-feature handoff, `config.planning.executeOnMerge` defaults to
`true` when a new assessment is installed with hosted planning enabled. An explicit
`false` remains an opt-out. Existing installations (including legacy missing flags)
are not silently opted in. To enable one, explicitly set it true in the installed
configuration and preview/apply `crewbie update`. Install the updated workflows and commit
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
  A regenerated plan can reuse identical setup, plan or batch files: these remain
  in the manifest even when GitHub omits them from the PR diff. Every omitted file
  must also match the recorded planning base; it is not exempt from content checks.

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
In the evaluated settings, context files did not generally improve task success
and increased inference cost; repository overviews were not helpful. The authors
still identify value in non-standard coding practices. These are study-specific
observations, not a universal instruction ban or proof that a particular number
of words is harmful.

Crewbie's documentation/profile overlap, generic-advice, unverified-link,
npm-script, broad-root-scope and unconditional full-suite signals are **engineering heuristics**,
not validated causal rules from the paper. They identify concrete material for
human review. Necessary standalone context and explicit merge/compliance gates
should be retained. Contradictions, domain relevance and actual benefit still
need semantic review and representative before/after task evidence.
The 600-word root-guidance review threshold is advisory, not a gate. Scoped
Copilot instructions need valid YAML `applyTo` globs. When relocating domain
guidance, review the source reduction and destination together; preserve policy
coverage and host-specific instruction support. Every finding must explicitly
select `retain`, `edit` or `defer`. Concrete edits require complete replacements
listed in `editPaths`; a scoped move must include its source reduction.
Deferred recommendations require a nonempty `deferReason` identifying the blocker
and appear separately in the terminal and Markdown report. Routine approval alone
is not a reason to defer a safe proposal: approval already gates every write.
The model must assess every inspected file for all justified improvements, not
stop after one file or the static warning list. Retained guidance needs an
evidence-based rationale; nothing forces edits to already useful rules.
See the [README sources](../README.md#sources-behind-guidance-assessment).

The scanner reads visible non-ignored instruction files, README/CONTRIBUTING
documents and package manifests. It checks at most 32 instruction files, 12
reference documents and 20 manifests, with 64 KB per file and 512 KB total;
omissions are reported. Root guidance is prioritized before specialist profiles.
At most twelve signal details **per instruction file** are included, so a noisy
root file cannot exhaust the coverage for other files. `signalsOmitted` reports
remaining detected warnings rather than presenting the sample as complete.
These are inspection resource limits, **not quality thresholds**. No project
script or linked URL is executed. The remaining configurable word budgets are
readability constraints, not research-derived quality scores.

## Launch preflight, limits and stop controls

`crewbie preflight [--batch-id ID] [--json]` performs read-only inspection of the
managed tasks, current approval, dependencies, repository capacity, sources,
specialist files and live account models. It exposes requested models and profile
revisions, not proof of effective cloud-runtime selection. Missing catalog
entitlement stops launch; no model fallback or automatic paid retry is permitted.
Both issue assignment and review/correction launches repeat the guards.

`modelProfile` is `balanced` by default; `init --model-profile economy|balanced|quality`
sets the reviewed selection policy. Capability comes before price in every profile,
including non-code work. Existing models and explicit overrides remain unchanged.
An LLM's suitability rationale is a proposal, not a benchmark certification.

```json
{
  "modelProfile": "balanced",
  "execution": {
    "maxLaunchesPerBatch": 20,
    "maxAttemptsPerTask": 3
  }
}
```

These configuration fields are optional for legacy configurations so parsing does
not change approved plan hashes. Absent limits use 20/3. Changing the profile alone
does not reassign models. Each Crewbie-initiated implementation/review launch
reserves one attempt under the existing repository dispatch lock **before** the
paid request. Initial launches, continuations and unknown request outcomes consume
allowance. Remote `crewbie/launches/<batch>/<task>/<issue>/...` tags retain the
ledger across local CLI sessions and Actions runs. Stable batch/task identities
keep the count across revisions. Do not delete or edit these refs to bypass limits.
The budget covers Crewbie requests, not the number of internal backend sessions,
tokens, monetary spend, manual PR follow-ups, onboarding, planning or nightly work.

**Upgrading an in-flight batch:** pre-alpha.10 launch claims have no trustworthy
complete attempt ledger. Further automatic launches in that batch stop visibly,
but existing sessions and completed work are not changed. Review each reported
issue's history (initial, correction, retry and uncertain requests), then record
the count without rebuilding the setup or republishing the tasks:

```powershell
crewbie budget --issue 42 --historical-attempts 2
crewbie budget --issue 42 --historical-attempts 2 --apply
crewbie preflight
```

The count is an explicit **human attestation**, not observed billing. It adds a
one-time immutable baseline consuming allowance; it cannot overwrite existing
history or refund attempts. Repeat for each unaccounted legacy claim that
preflight identifies. If you cannot establish its history, keep that batch
blocked rather than inventing a count. This does not repeat paid analysis.

`crewbie pause` previews a repository-wide gate; `--apply` requires a configured
human approver and uses the same lock as dispatch/review. If dispatch holds the
lock, pause fails visibly: do not assume the repository is paused; retry once the
current operation ends. Once confirmed, no new controlled implementation/review
launches pass the gate. Already-running sessions continue. Planning and nightly
analysis have their own opt-in controls and are not paused by this command.
`crewbie resume --apply` removes only the gate, preserving claims and counters;
it does not itself dispatch.

`crewbie cancel --issue N --run-id ID` previews cancellation after verifying an
unambiguous closing Copilot PR and matching repository, branch, PR identity and
`dynamic` Actions run. `--apply` requires a human approver, rechecks the run and
requests the documented Actions cancellation operation. The result distinguishes
an accepted request from a confirmed cancelled run. Native termination and
capacity are not assumed from the request; saved commits and claims remain.
An inaccessible/unsupported cancellation is an explicit error with instructions
to use GitHub's **Stop session** control. There is no force-cancel or replacement
fallback.

Sources: [GitHub session management](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents#stop-a-session)
and [Actions cancellation](https://docs.github.com/en/rest/actions/workflow-runs#cancel-a-workflow-run).
The documented [Agent Tasks API](https://docs.github.com/en/rest/agent-tasks/agent-tasks)
does not itself expose a task-cancellation endpoint; Crewbie does not invent one.

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
review or after it is closed without merging. Closed-unmerged work stays failed,
retains its claim, and never satisfies a prerequisite. Missing, ambiguous, active or
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

Specialists close each task by assessing **handoff knowledge and reusable lessons
separately**. New contracts, integration constraints, decisions and limitations
needed by dependent tasks belong in relevant hot/index or linked topic memory,
even without a general lesson. Link discoverable implementation details instead
of copying them. A no-update handoff needs a reason or a pointer to the exact
existing memory section; "no new durable lesson" alone is insufficient.
Approved memory paths can be changed on the work branch for human review;
existing accepted policy is preserved.
New shared decisions remain explicitly proposed until approved. Out-of-scope
lessons go in one PR comment starting with `<!-- crewbie-memory-proposal -->`,
with target path, lesson, reason and evidence. The collector includes bounded
proposals from the Copilot bot or configured approvers in nightly input. It does
not promote comments to policy or force repetitive activity logs for routine work.

On an implementation PR, mention `@copilot` with specific changes or a targeted
handoff request. GitHub continues using the same custom agent on its PR; another
session can consume AI credits. Review and merge the new changes. On a planning
PR, use the bounded `revise-plan` flow instead so provenance and manifest hashes
are regenerated.

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
`spec`, `hot`, `constitution`, `topic`, and `pr`.
Charters are bounded only by GitHub's 30,000-character agent prompt maximum; role
indexes and shared decisions have no word limit. Legacy `charter`, `index` and
`decisions` entries are ignored.
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
Node 22.12+ on Windows, macOS and Linux. Onboarding transport also exercises the
bundled SDK runtime against a loopback-only synthetic provider without paid model
calls.

Before broader release, run a consenting personal/organization account matrix:
select the actual profile/model, inspect memory-read attestations and issue/PR
linkage, exercise maintenance authentication, and confirm private publishing.
No live test is implied by a fixture passing. Registry publishing, trademark
clearance, and paid cloud runs require the project owner's separate decision.
