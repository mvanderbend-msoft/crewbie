<div align="center">

# Crewbie

### A small crew, not a big process.

**Your requirements. A project-specific crew. Memory worth keeping.**

[![CI](https://github.com/mvanderbend-msoft/crewbie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mvanderbend-msoft/crewbie/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mvanderbend-msoft/crewbie?include_prereleases&color=b11f4b)](https://github.com/mvanderbend-msoft/crewbie/releases)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Quick start](#quick-start) &nbsp; / &nbsp;
[Principles](#our-principles) &nbsp; / &nbsp;
[Meet the crew](#meet-the-crew) &nbsp; / &nbsp;
[How it works](#from-idea-to-reviewed-pr) &nbsp; / &nbsp;
[Operations guide](docs/operations.md)

</div>

---

Crewbie brings a small AI implementation team to your **existing or greenfield
GitHub project**. Supply your PRD, spec or issue requirements, approve the task
breakdown, and let named GitHub cloud specialists implement, test and review it. Keep the code,
decisions and useful lessons in Git. Keep final approval with people.

| Less ceremony | Real specialists | Learning without the baggage |
|---|---|---|
| Bring your requirements, not a mandatory document chain. | Repository-specific charters, explicit models and visible PR attribution. | Curated role memory and evidence-backed improvement PRs, not growing transcripts. |

> [!IMPORTANT]
> **Alpha software.** Commands and GitHub preview interfaces may change.
> Live workflows have been exercised on an eligible account, not every account
> or organization policy. Cloud runs can incur charges. Nothing silently falls
> back to a generic agent or a different model.

## Our principles

These are the design rules behind Crewbie, not extra documents for your team to fill in.

| Principle | What it means in practice |
|---|---|
| **Fit the repository.** | Assess before generating. Reuse existing instructions, tests and decisions; don't demand a rewrite to adopt AI. |
| **Implement supplied requirements.** | The user owns the PRD/spec and acceptance criteria. Crewbie decomposes the work and asks about gaps rather than authoring requirements. Small fixes can use an issue. |
| **Let the crew evolve.** | Derive expertise from the repository and each feature, not a fixed roster. Add, specialize or retire roles through review; preserve history and existing task ownership. |
| **People own the decisions.** | Humans approve scope, owners, models and execution. Crewbie merges task PRs only into the plan's feature branch; a human tests that branch and merges its one feature PR into the default branch, and every learning proposal. |
| **Automate inside clear limits.** | Bound concurrency, review rounds and maintenance work. Stop visibly on blockers or uncertain launches; don't blindly retry paid sessions. |
| **Remember lessons, not everything.** | Keep current knowledge hot, retrieve deeper history by topic, and archive superseded detail. No new lesson means no forced memory change. |
| **Instructions must earn their place.** | Prefer concrete repository guidance over duplicated docs or generic advice. Quality warnings cite evidence; length alone is not a quality score. |
| **Improve from evidence.** | Propose guidance changes from actual outcomes and feedback. Never turn an agent's suggestion into accepted policy automatically. |
| **Say what is known.** | Distinguish requested models from observed models, inspected commands from executed checks, and unknown usage from zero cost. |
| **Write for the reader.** | Explain what changed, why and what was checked. Keep artifacts short enough to review; link detail instead of repeating it. |

**Deliberate non-goals:** a new agent runtime, an always-on server, a vector
database, raw-transcript memory, PRD/spec authoring, automatic merges, or a heavyweight process
you must adopt before writing code.

## Quick start

### 1. Install the alpha

You need **Node.js 22.12+**, **Git**, an authenticated **GitHub CLI**, and an eligible
**Copilot account**. Local assessment uses the bundled official Copilot SDK runtime;
a separate Copilot CLI installation is not required for init. Cloud execution also
needs repository access; check the [capability matrix](docs/operations.md#account-and-runtime-capability-matrix).

```powershell
npm install --global --ignore-scripts https://github.com/mvanderbend-msoft/crewbie/releases/download/v0.1.0-alpha.40/crewbie-cli-0.1.0-alpha.40.tgz
gh auth login
```

> [!NOTE]
> This alpha is distributed as an **npm-installable GitHub release tarball**,
> with a `SHA256SUMS` file attached to the release. npm registry publication
> remains deferred; no npm account is needed to install the release tarball.
> To build and install directly from this repository instead:
>
> ```powershell
> npm ci --ignore-scripts
> npm pack
> npm install --global --ignore-scripts .\crewbie-cli-0.1.0-alpha.40.tgz
> ```
>
> Installing Crewbie does not start agents.

### 2. Assess your project and generate the team

Run this **inside the repository you want your crew to work on**, not inside the
Crewbie source repository:

```powershell
crewbie init
```

In an interactive terminal, init presents an arrow-key model selector with names,
IDs and billing multipliers when supplied by Copilot. Use **Up/Down** and **Enter**;
**Ctrl+C** cancels. Redirected/scripted runs use explicit flags instead of a menu.
This selects the
**assessment model**. By default, new specialists receive cost-aware model
proposals from your live account catalog, with complexity and a rationale in the
report. Reported token prices/capabilities inform the proposal; missing prices
stay unknown and capability judgments are not benchmark guarantees.
Installed model choices are preserved. `--model MODEL` skips the assessment picker;
`--model-policy fixed` or `--specialist-model MODEL` explicitly overrides new-role
selection and skips specialist discovery. `auto` is not supported.

Choose `--model-profile economy|balanced|quality` (default **balanced**).
Economy favors the least expensive **capable** option; balanced weighs quality,
rework risk and cost; quality prioritizes correctness and difficult reasoning.
Every profile treats language, architecture and other non-code work as potentially
quality-sensitive. These are reviewed LLM proposals, not measured model rankings.
The profile is saved in configuration and does not replace explicit model choices.

Init then uses the Copilot SDK to assess existing
instructions, custom agents, MCP configuration metadata, decisions and project
code. The CLI shows a short summary and writes **`crewbie-setup.md`** with the
assessment, per-file findings, coverage limits, proposed crew and exact guidance
edits. The editable setup remains in `crewbie-setup.json`. Custom `--out FILE.json`
produces a sibling `FILE.md` report.

Crewbie adopts suitable existing specialists and actively considers useful additions:
domain depth, independent verification, accessibility, performance and integration
boundaries. Broad existing ownership does not rule out a justified specialization.
For example, existing frontend and backend engineers become distinct
`crewbie-frontend-engineer` and `crewbie-backend-engineer` specialists, not an
unrelated combined role. After approval, originals move into
`.crewbie/agent-archive/` as backup provenance. Their **complete original instructions
remain inside the active Crewbie charter**, alongside Crewbie context and handoff
rules; tool restrictions, descriptions and professional persona are preserved.
The selected model and adopted handoff targets are synchronized. Adopted
instructions are never truncated. Crewbie applies no word limit to charters
because no evidence supports one. It stops only at GitHub's documented
30,000-character agent prompt limit; if the full charter exceeds it, init asks
you to shorten the original.
Every inspected candidate receives an
adopt/retain decision with a reason. Static detection is evidence, not the roster;
`maxActive` limits simultaneous work, not the number of specialists.

For greenfield projects, initialize Git first and describe the purpose, users,
main behavior, stack/platform (or freedom to choose) and constraints. Init asks
follow-up questions when the description is insufficient; it never installs a
guessed team. You can supply context with `--description "..."`.

Review the grouped **Team / Guidance / Deferred / Coverage** summary, then select
**Team**, **All** (team plus guidance/constitution edits), or **Save** from the
arrow-key menu. **Save is the default.** Init groups the exact file changes by
create/update/archive and shows GitHub labels before a separate confirmation,
which defaults to no. Existing constitutions remain reusable.
Recommendations are clearly separated from concrete edits: if no guidance edits
were proposed, init says so. Team-only installation keeps those proposals saved
for later review instead of discarding them.

Each inspected guidance file receives an explicit **retain**, **edit**, or
**defer** decision. The review covers discoverable facts, duplication, stale
commands/links, generic advice, scoping and non-obvious constraints—not just the
first warning or one file. Safe improvements require complete proposed replacement
text; scoped moves include both the source reduction and destination. Deferrals
must name a concrete blocker and are shown separately; **All** does not apply them.
Static warnings remain evidence to assess, not automatic rewrite instructions.

> Available from alpha.11. Earlier releases use typed choices and
> archived-charter references.

The terminal formatting also extends beyond init: grouped help, command headings,
status colours, aligned tables and readable nested details are shared by status,
doctor, preflight, publication previews and other commands. Narrow terminals use
stacked fields instead of cramped tables; long paths and Unicode text wrap without
discarding information. Errors are separated visually from normal output.
Set `NO_COLOR` to disable colours. Redirected output keeps its existing plain/JSON
format, and supported `--json` views remain machine-readable even in a terminal.
These presentation changes are available from alpha.11.

Init separately asks whether to enable hosted planning with the selected model.
Opting in permits potentially billable planning when a trusted human applies
`crewbie:ready-for-planning`. When hosted planning is enabled in a **new installation**,
`executeOnMerge` defaults to true: implementation starts only after a configured
human approves the exact final planning commit and merges it. Existing explicit
opt-outs are preserved; upgrades do not silently enable paid execution.

Analysis may consume AI credits. It runs tool-free in an isolated working/config
directory, authenticating through `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
`GITHUB_TOKEN`, or `gh auth login`. It does not run repository scripts or MCP
servers. Personal/global MCP configuration is outside the assessment.
The SDK uses shell-free stdio and waits for a completed assistant response;
init gives a friendly status update with elapsed time every 15 seconds, then announces validation.
This is a status heartbeat, not a completion estimate; model responses can take
several minutes.

Role context links must point to inspected, unredacted Markdown documents, not
source-code files or directories. Init supplies the model with the eligible paths
and normalizes harmless Windows separators and `./` prefixes. If a model still
returns invalid links, interactive init lets you select replacements, explicitly
remove rejected links, or cancel **without another paid assessment**. Valid links
are retained; nothing is silently dropped or installed.

Empty or malformed JSON stops onboarding with an actionable error instead of
installing a fallback team. Use `--assessment-only` for an explicitly offline
inventory instead; it does not discover models or contact Copilot.

### 3. Scripted preview and installation

```powershell
crewbie init --model MODEL --repo OWNER/REPO --out crewbie-setup.json
crewbie init --proposal crewbie-setup.json
crewbie init --proposal crewbie-setup.json --apply --guidance skip
```

Without a terminal, init saves the assessment/team JSON for review. Apply with
`--guidance skip` to keep existing guidance, or `--guidance apply` to include
the proposed changes. All workflow labels, including `crewbie:ready-for-planning`
and dynamic owner labels, are created on apply. `--skip-labels` explicitly opts
out for offline setup. With hosted planning enabled, `--copilot-version X.Y.Z`
sets a missing `CREWBIE_COPILOT_VERSION` (interactive init asks). Edited-file conflicts stop installation.
Installation previews are readable file/action lists; use
`crewbie init --proposal crewbie-setup.json --json` for a JSON preview.

Commit the reviewed setup to your default branch before cloud dispatch.
For hosted reporting or learning, also configure the
[workflow settings](docs/operations.md#human-approval-and-credentials).
Generated workflows default to the exact installed version's GitHub release tarball; an
optional `CREWBIE_PACKAGE` variable can override it with an approved pinned build.
Local dispatch can use your existing GitHub CLI authentication without storing
an assignment token in Actions.

## Meet the crew

The team follows your repository, not a fixed roster. A Java/React project might
use the following crew; a smaller project should need fewer implementation roles.

| Specialist | Runs primarily in | Owns |
|---|---|---|
| **Coordinator** | Local Copilot CLI or GitHub Actions | Supplied-requirement intake, dynamic team proposals, task ownership and dependencies. |
| **Frontend** | GitHub cloud agent | UI state, accessibility, interaction and browser recovery. |
| **Backend** | GitHub cloud agent | API contracts, validation, persistence and transaction boundaries. |
| **Tester** | GitHub cloud agent | Regression coverage and evidence from the actual combined implementation. |
| **Reviewer** | GitHub cloud agent | Independent findings tied to the exact commits reviewed. |
| **Improver** | Scheduled GitHub Actions | Bounded, evidence-backed guidance proposals; opt-in execution. |

Each agent profile **is its charter**, with its own bounded history. Shared
working rules live once in `.crewbie\instructions.md`. Reviewed `checks` and
`nonNegotiables` can add repository-specific requirements without repeating
generic boilerplate. A provisioned role does not run on every task.

### Change the project, reassess the crew

```powershell
crewbie init --update --model MODEL --out team-review.json
```

Reassessment preserves your approved models, policy and custom roles. It reports
new expertise signals and existing roles worth reviewing instead of resetting
the team. Signals include UI/service frameworks, infrastructure, data, mobile,
AI integrations, CLI entry points and documentation tooling.

These are **hints, not a closed catalogue**. The coordinator can propose a
`payments-ledger` specialist or another domain role that the detectors don't
know. Review its purpose, checks and non-negotiables before applying the setup.
Missing signals never automatically delete a role or its memory. Review open
work before retirement; model and ownership changes still need approval.

### Upgrade the repository integration without reassessment

First update the CLI separately with npm using the desired release tarball. Then,
inside your project:

```powershell
crewbie update
crewbie update --apply
```

The first command previews managed workflow, charter, shared-rule and template
changes. It also checks whether an existing Actions `CREWBIE_PACKAGE` override
still points at an older package. Apply updates that override and the reviewed
files using the installed CLI version. Commit the resulting file changes.
No AI assessment, model change, policy reset, workflow dispatch or agent launch
occurs. Edited managed files are listed as conflicts and block application;
memory and accepted decisions are preserved. `--offline` explicitly skips GitHub
variable inspection, so a remote override may still need attention.
`init --update` remains the separate, potentially billable **team reassessment**.
Text and JSON previews explain **why each file exists and who owns it**.
No duplicate template directory is copied into your project.
For batches already running before alpha.10, see the
[historical launch baseline](docs/operations.md#launch-preflight-limits-and-stop-controls)
before resuming dispatch; no reinitialization is required.

## From idea to reviewed PR

**Assess > Supply requirements > Decompose > Approve > Implement > Review > Human merge > Learn**

### Start from a GitHub issue

With [hosted planning enabled](docs/operations.md#ready-label-issue-intake):

1. Put the spec/PRD text in a GitHub issue.
2. A human user with write access adds **`crewbie:ready-for-planning`**.
3. The hosted coordinator reads its charter/history and repository assessment
   and decomposes the work into tasks owned by the existing specialists.
4. A ready-for-review, **non-draft** planning PR presents specialist-owned tasks and
   dependencies. It only adds files under readable paths such as
   `.crewbie/plans/saved-signals-favorites-issue-1/`; agents, memory and
   configuration are never changed (missing expertise is listed as a suggestion).
   Clarification-only plans remain drafts; repository
   checks and review requirements still apply.
5. **Approve the final planning commit and merge the PR.** With
   `planning.executeOnMerge` enabled, Actions publishes the approved tasks and
   dispatches the named cloud specialists. No per-feature CLI handoff is needed.

**The ready label authorizes planning; approval plus merge authorizes execution.**
This needs one-time setup of a supported user-authorized assignment credential.
Both the reviewer and merger must be human users with write access. Stale approvals,
changed source requirements and clarification-only plans cannot start coding.
Unlabeled issues and labels applied by read-only users or bots do not trigger analysis.
Planning uses the named coordinator's supplied context in a tool-free Copilot CLI
job, not a native cloud implementation session. Each plan is delivered on its
own feature branch, `crewbie/<plan>-<revision>`: tasks start from it, and their finished PRs
are marked ready and merged into it once every check passes, without review. When
every task merged, Crewbie opens one feature PR into the default branch that closes
all of the plan's issues. Init picks a Crewbie reviewer role (`review.role`,
preferring an existing review specialist) that comments on each head of that
feature PR. You test the feature branch and merge the feature PR yourself; Crewbie
never merges it. A task PR that changes `.github/workflows/` is left for you to
merge. A failed start or session is relaunched by adding `crewbie:restart`.
Issues published before feature branches are no longer dispatched; finish them
by hand.

> **Recommended:** in the repository, open *Settings → Copilot → Cloud agent* and
> turn off **Require approval for workflow runs**. GitHub otherwise holds the
> dispatch run that Copilot's finished session triggers, and Crewbie only
> notices on its hourly schedule (which GitHub can delay), so each task PR can
> wait an hour or more before it merges and the next task starts. Crewbie cannot
> approve those runs for you.

Without `executeOnMerge`, the manual team-installation and batch-approval path
below remains available. See [approval-to-execution setup](docs/operations.md#approve-and-merge-to-execute)
for credentials, workflow recovery and approval boundaries.

### Test a feature locally

From the repository root, ask your IDE agent to test the feature or run:

```powershell
crewbie test "galactic ratings"
```

Crewbie lists or matches open feature PRs and in-progress Crewbie feature
branches, refuses to touch a dirty working tree, fetches and switches to the
selected `crewbie/...` branch, and then runs `local.start` from
`.crewbie/config.json`. Configure it during init with `--start "npm run dev"` or
add `"local": { "start": "npm run dev" }` to the reviewed config. Use
`crewbie test --list`, `crewbie test 73 --no-start`, or `crewbie test 73 --json`
for listing, checkout-only and machine-readable selection.

### Answer questions or disagree with the plan

When the plan needs clarification, Crewbie opens it as a draft and posts the
questions as a PR comment. **Reply on the PR** with your answers; a write-access user's
reply runs one paid revision of the same PR. When the plan has no open questions,
start a comment with `/crewbie revise` followed by your feedback. Other comments,
edited comments, bots and read-only users never start a run.

From a terminal, the same revision is available locally:

```powershell
crewbie revise-plan --pr 7 --feedback-file feedback.txt
crewbie revise-plan --pr 7 --feedback-file feedback.txt --apply
```

Preview is read-only. Apply explicitly requests **one potentially billable revision**
on the same PR, reusing the previous plan instead of rerunning init or the full
assessment. Stale heads, changed requirements during analysis and unrelated PR
edits stop publication; Crewbie never force-pushes. If the default branch moved,
the revision merges it into the planning branch automatically. Review and approve the **new final commit**;
earlier approvals do not authorize it. There is no automatic paid retry loop.
Use this command for planning revisions so the execution manifest is regenerated,
rather than asking an unstructured comment to edit only `plan.md`.

### Request implementation changes in a PR comment

On a Crewbie **feature PR**, comment **`/crewbie fix`** with optional notes after
a Crewbie changes-requested review. A write-access user's new, unedited comment
creates paid follow-up task issues routed back to the owning specialists: Crewbie
groups review findings by the task PRs that changed the affected files, publishes
approved fix tasks against the same feature branch, dispatches them through the
normal launch budgets, auto-merges their task PRs into the feature branch, and
requests a fresh Crewbie review of the new feature-PR head.

`/crewbie revise` on a feature PR does the same thing; `/crewbie revise` on a
planning PR still requests a planning revision. If the feature branch cannot
merge the current default branch, Crewbie first creates a conflict-resolution
task. That specialist merges `origin/<default>` into their task branch, resolves
the conflicts and opens the task PR back into the feature branch. If that PR
touches `.github/workflows/`, the existing human-merge guard still applies.

**Handoffs and memory are different.** Downstream contracts and integration notes
go in the PR's Handoff section; dependent tasks read the merged code and PR. Hot
memory holds only gotchas: non-obvious traps, surprising constraints and failed
approaches, one or two lines each with a link. No implementation summaries, scope
notes or verification logs. If nothing was surprising, memory stays unchanged and
the PR's Learning section says why. Out-of-scope updates become explicit
proposals; humans review and merge memory changes.

### Or plan locally

Use the installed `crewbie` skill in Copilot CLI to break a supplied PRD, spec or
issue into small implementation tasks. Review the owners, models,
scope and dependencies before approving execution.

```powershell
crewbie status --source requirements.md
crewbie status --batch batch.json
crewbie approve --batch batch.json --yes --execute
crewbie publish --batch batch.json
```

The last command previews publication. **The following command publishes the
approved work and can start paid native cloud sessions:**

```powershell
crewbie publish --batch batch.json --apply --dispatch-local --watch
```

The watcher reconciles work within the repository's concurrency limit. It
releases eligible specialists and stops at handoff, a blocker or timeout.
Implementation dependencies require merged PRs; explicitly approved review tasks
can inspect completed, unmerged work. A completed session does not mean its
tests or review passed.

See [the batch example](examples/batch.json) and
[scheduling and recovery](docs/operations.md#scheduling-and-recovery).

### Know what will launch, and stop new work

```powershell
crewbie preflight
crewbie preflight --batch-id feature-name --json
crewbie pause
crewbie pause --apply
crewbie resume --apply
crewbie cancel --issue 42 --run-id 123456789
crewbie cancel --issue 42 --run-id 123456789 --apply
crewbie reapprove --issue 42,43
crewbie reapprove --issue 42,43 --apply
```

To change a model after approval, edit the role's `model` in
`.crewbie/config.json`, run `crewbie update --apply` and push. Then
`crewbie reapprove --issue N` moves those open tasks to the new model and posts
your approval of the exact updated issue; add `crewbie:restart` to a task that
already tried to start.

Preflight is read-only: it shows approvals, dependencies, selected specialist/model,
profile revision and remaining launch allowances. Execution repeats its guards
under a repository-wide lock. Models are checked against the live account catalog.
Before a launch, the cloud agent must also accept them (see operations). That does
not prove the runtime will use them. No silent fallback.

Defaults are **20 Crewbie launch attempts per batch and 3 per task**, including the
initial attempt, reviews/corrections and uncertain requests. Configure
`execution.maxLaunchesPerBatch` and `execution.maxAttemptsPerTask` in the reviewed
config. Reservations persist across machines and workflow retries. These are
**not monetary/token caps** and do not control manual `@copilot` sessions, init,
planning or nightly analysis.

Pause prevents new implementation/review launches after it acquires the dispatch
lock; it does not stop active sessions. Resume never resets allowances or starts
work itself. Cancel targets only an attributable Copilot Actions run, preserves
pushed commits and reports **requested versus confirmed** cancellation. If the
backend or credential cannot cancel it, use **Stop session** in GitHub's session
viewer. Neither cancellation nor failure refunds an attempt or automatically
launches a replacement.

### Let the reviewer close the loop

For an approved review plan with exact issue digests, target PRs, correction
paths and a round budget:

```powershell
crewbie publish --review-loop review.json
crewbie publish --review-loop review.json --apply --watch
```

The named reviewer produces findings against exact commits. Crewbie publishes
actual GitHub reviews, sends required fixes to the **original specialist on the
same PR**, refreshes tester evidence when included, and independently re-reviews.
Specialist attribution stays visible in PR descriptions.

> [!WARNING]
> This optional mode uses the Agent Tasks API, which currently requires an
> eligible Business/Enterprise seat and user-authorized access. Basic issue
> assignment eligibility is not enough. Automated reviews are explicitly
> attributed to the specialist but published by the authorized coordinator;
> they are **not human approval**. Crewbie never merges the PRs.

The [review-plan format and recovery guide](docs/operations.md#autonomous-review-and-correction)
explain scope guards, uncertain launches and round limits.

## Memory that stays useful

| Layer | Keep here | Read when |
|---|---|---|
| **Hot** | Current constraints and recurring lessons. | The role starts work. |
| **Index** | Short topic pointers and relevance cues. | Finding the right history. |
| **Cold** | Deeper topic summaries with evidence. | The current task needs them. |
| **Archive** | Superseded detail and its provenance. | Investigating an older decision. |

Shared decisions belong in a compact repository-wide record; role history
captures practical lessons. Reuse existing ADRs rather than copying them.
Specialists propose useful lessons in scoped PR changes, or defer them to
nightly review when memory is outside their approved scope. No compulsory churn.

Nightly learning is **opt-in**. Preparation, tool-free Copilot analysis and
guarded publication run separately with scoped job tokens. The improver proposes
changes in one human-reviewed PR, skips unchanged evidence, and cannot expand
its own permissions or edit application code.

### Small defaults, explicit exceptions

| Surface | Default budget |
|---|---|
| Batch scope/source reference / constitution | 600 words each |
| Specialist charter | No word limit; GitHub's 30,000-character agent prompt maximum |
| Role hot memory | 600 words |
| Role index / active shared decisions | No word limit |
| PR description | No word limit (set `limits.pr` to enforce one) |
| Concurrent implementation sessions | 2 per repository |
| Nightly input / improvement PRs | 20 new records / 1 active PR |

Budgets are configurable. Word limits are readability constraints, not quality
scores or token limits. Workflow timeouts are not guaranteed spending caps.

<details>
<summary><strong>What gets added to my repository?</strong></summary>

```text
.github\agents\crewbie-*.agent.md       Specialist charters
.github\skills\crewbie\SKILL.md         Local implementation workflow
.github\workflows\crewbie-*.yml         Planning, dispatch, improvement and reporting
.crewbie\config.json                   Approved team and execution policy
.crewbie\instructions.md               Shared working rules
.crewbie\constitution.md               Approved principles, or an existing path
.crewbie\decisions.md                  Compact shared decisions
.crewbie\team\<role>\hot.md            Current role knowledge
.crewbie\team\<role>\index.md          Topic pointers
```

User-provided requirements stay authoritative; Crewbie adds no Spec Kit scaffolding.
Cold/archive detail appears when needed, not as empty document trees.
The installer tracks ownership and stops on conflicting human edits.
`update` refreshes integration; `init --update` reassesses the team. Both preserve ownership.

</details>

## See what happened

```powershell
crewbie dashboard --collect --out crewbie-dashboard.html
```

The static report filters by specialist, model and date. It separates requested
and observed models and leaves missing measurements **unknown**, not zero.
Collected work records are not an exhaustive session or billing ledger.
Hosted reports default to an access-controlled Actions artifact; public hosting
requires explicit opt-in.

Completed native PRs receive a usage summary during dispatch reconciliation.
**Observed tokens** aggregate identifiable main-session input/output log records
across known sessions, with coverage and an evidence link. Missing/expired logs,
unreported subagent usage and incomplete session coverage are disclosed; these
counts are not unique context tokens or an invoice. The preview Agent Tasks API
reports `usage.amount` with a type but does not document its scaling, so **AI credits
remain unavailable** rather than dividing by a guessed factor. Planning CLI
metrics likewise remain unavailable. Native telemetry and Actions-log access are
needed; no new paid inference is used to collect usage.

Use `crewbie status --pr 13 --json` for the observed counts, evidence URLs and
coverage warnings without editing the PR. If GitHub requires **Approve and run
workflows** for a Copilot PR, automated metadata updates wait for that permission.

Instruction assessment also flags copied documentation, repeated charter
boilerplate, generic advice, unverified links and suspect test directives.
Inspired by [Gloaguen et al., *Evaluating AGENTS.md*](https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd),
these are advisory engineering heuristics with file/line evidence, not
paper-validated causal rules or automatic permission to rewrite instructions.
Read the [evidence and limitations](docs/operations.md#instruction-quality-evidence-and-limits).

### Sources behind guidance assessment

Crewbie favors non-obvious constraints, rationale and gotchas over descriptions
an agent can cheaply discover from code or configuration. It reviews root-file
scope, domain `AGENTS.md`, `applyTo` instructions, custom-agent responsibilities,
permissions and duplication. Safe edits include complete replacement text and
source/destination changes when splitting guidance; they apply only with your
separate guidance approval. Unresolved policy choices stay explicitly deferred.

| Source | How Crewbie uses it |
| --- | --- |
| [Gloaguen et al., Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) | Study-specific success/cost findings motivate reviewing unnecessary context and repository overviews, not deleting useful policy or claiming a universal size limit. |
| [GitHub custom-instruction support](https://docs.github.com/en/copilot/reference/custom-instructions-support) and [response customization](https://docs.github.com/en/copilot/concepts/prompting/response-customization) | Choose repository-wide, path-scoped and agent instructions for the host that actually supports them. |
| [GitHub custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) | Review concrete descriptions, tool restrictions, model settings and precedence rather than inventing agent behavior. |
| [Copilot SDK usage and billing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing) | Discover account models and reported pricing; distinguish token telemetry from credit accounting. |
| [Agent Tasks REST API](https://docs.github.com/en/rest/agent-tasks/agent-tasks) | Attribute native sessions to PRs and disclose preview API/accounting limitations. |
| [Continuing a cloud-agent session](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github#tracking-and-continuing-a-session) | Document same-custom-agent `@copilot` follow-ups. |

The scanner's 600-word root-guidance review threshold and other static signals
are **Crewbie heuristics**, not proven causal rules or quality certifications.
Preserve intentional policy and assess representative task outcomes before
claiming a token or quality improvement.

## Build and contribute

```powershell
git clone https://github.com/mvanderbend-msoft/crewbie.git
cd crewbie
npm ci --ignore-scripts
npm test
npm pack
```

Source is TypeScript; the npm package contains prebuilt JavaScript and a small
JSONC parser for MCP settings. Keep contributions small, cover behavior changes
with tests, and preserve the principles above.

For credentials, ADO integration, workflow deployment, upgrades and recovery,
start with the [operations guide](docs/operations.md).
Report reproducible problems in [GitHub issues](https://github.com/mvanderbend-msoft/crewbie/issues).

### Publishing to npm (maintainers)

Publishing requires an npm account with two-factor authentication and permission
to publish under **`@crewbie`**. A GitHub login alone does not grant npm access.
Create the `crewbie` organization using npm's free **Unlimited public packages**
plan, or obtain access from its owner. If the scope is unavailable, choose a new
package name explicitly before publishing.

Authenticate from your own terminal; never paste credentials or recovery codes
into an issue, chat, repository file, or command argument:

```powershell
npm ping --registry=https://registry.npmjs.org
npm login --auth-type=web --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
```

If registry access fails with a TLS error, use your organization's approved
proxy/CA configuration rather than disabling certificate verification.
After the first publication, configure npm trusted publishing for the GitHub
release workflow, then explicitly set `CREWBIE_NPM_PUBLISH_ENABLED=true` as a
repository Actions variable. Until enabled, releases only upload the
npm-installable GitHub artifact and checksum. See
[npm publishing](docs/operations.md#npm-publishing) for the bootstrap command,
workflow identity and release tags. Alpha releases use the `next` npm tag,
not `latest`.

---

**MIT licensed.** Inspired by [Brady Gaster's Squad](https://github.com/bradygaster/squad)'s
specialist teams and repository-backed history. Crewbie is an original,
smaller implementation, not a fork or a compatibility layer.
The name remains subject to branding clearance.
