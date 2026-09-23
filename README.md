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
| **People own the decisions.** | Humans approve scope, owners, models and execution. Application changes and learning proposals still need human review and merge. |
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
npm install --global --ignore-scripts https://github.com/mvanderbend-msoft/crewbie/releases/download/v0.1.0-alpha.6/crewbie-cli-0.1.0-alpha.6.tgz
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
> npm install --global --ignore-scripts .\crewbie-cli-0.1.0-alpha.6.tgz
> ```
>
> Installing Crewbie does not start agents.

### 2. Assess your project and generate the team

Run this **inside the repository you want your crew to work on**, not inside the
Crewbie source repository:

```powershell
crewbie init
```

Init presents a numbered list of models available to your account, with names,
IDs and billing multipliers when supplied by Copilot. Choose a number or an exact
listed ID; invalid choices are reprompted, and `q` cancels. `--model MODEL` bypasses
discovery for scripted use; `auto` is not supported.

Init then uses the Copilot SDK to assess existing
instructions, custom agents, MCP configuration metadata, decisions and project
code. It shows a summary, per-file findings, coverage limitations and an
LLM-generated team with domain checks. Static stack detection is evidence, not
the roster. Existing guidance is reused through context pointers.

For greenfield projects, initialize Git first and describe the purpose, users,
main behavior, stack/platform (or freedom to choose) and constraints. Init asks
follow-up questions when the description is insufficient; it never installs a
guessed team. You can supply context with `--description "..."`.

Review the proposal, then choose **team only**, **team plus guidance/constitution
changes**, or **save without installing**. Init previews the exact files and
GitHub labels before confirmation. Existing constitutions remain reusable.

Analysis may consume AI credits. It runs tool-free in an isolated working/config
directory, authenticating through `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
`GITHUB_TOKEN`, or `gh auth login`. It does not run repository scripts or MCP
servers. Personal/global MCP configuration is outside the assessment.
The SDK uses shell-free stdio and waits for a completed assistant response;
empty or malformed JSON stops onboarding with an actionable error instead of
installing a fallback team. Use `--assessment-only` for an explicitly offline
inventory instead; it does not discover models or contact Copilot.

### 3. Scripted preview and installation

```powershell
crewbie init --model MODEL --repo OWNER/REPO --approver LOGIN --out crewbie-setup.json
crewbie init --proposal crewbie-setup.json
crewbie init --proposal crewbie-setup.json --apply --guidance skip
```

Without a terminal, init saves the assessment/team JSON for review. Apply with
`--guidance skip` to keep existing guidance, or `--guidance apply` to include
the proposed changes. All workflow labels, including `crewbie:ready-for-planning`
and dynamic owner labels, are created on apply. `--skip-labels` explicitly opts
out for offline setup. Edited-file conflicts stop installation.

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

## From idea to reviewed PR

**Assess > Supply requirements > Decompose > Approve > Implement > Review > Human merge > Learn**

### Start from a GitHub issue

With [hosted planning enabled](docs/operations.md#ready-label-issue-intake):

1. Put the spec/PRD text in a GitHub issue.
2. A configured human approver adds **`crewbie:ready-for-planning`**.
3. The hosted coordinator reads its charter/history and repository assessment,
   proposes the right crew, and decomposes the work into specialist-owned tasks.
4. A draft planning PR references the supplied requirements and presents specialist-owned tasks and
   dependencies. In merge-enabled mode it includes the actual team files too.
5. **Approve the final planning commit and merge the PR.** With
   `planning.executeOnMerge` enabled, Actions publishes the approved tasks and
   dispatches the named cloud specialists. No per-feature CLI handoff is needed.

**The ready label authorizes planning; approval plus merge authorizes execution.**
This needs one-time setup of a supported user-authorized assignment credential.
Both the reviewer and merger must be configured human approvers. Stale approvals,
changed source requirements and clarification-only plans cannot start coding.
Unlabeled issues and labels applied by unapproved actors do not trigger analysis.
Planning uses the named coordinator's supplied context in a tool-free Copilot CLI
job, not a native cloud implementation session. Application PR merges stay yours.

Without `executeOnMerge`, the manual team-installation and batch-approval path
below remains available. See [approval-to-execution setup](docs/operations.md#approve-and-merge-to-execute)
for credentials, workflow recovery and approval boundaries.

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
| Specialist charter | 400 words |
| Role hot memory | 600 words |
| Role index / active shared decisions | 400 words each |
| PR description | Normally 150-250 words |
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
`init --update` uses the same preview and ownership checks.

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

Instruction assessment also flags copied documentation, repeated charter
boilerplate, generic advice, unverified links and suspect test directives.
Inspired by [Gloaguen et al., *Evaluating AGENTS.md*](https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd),
these are advisory engineering heuristics with file/line evidence, not
paper-validated causal rules or automatic permission to rewrite instructions.
Read the [evidence and limitations](docs/operations.md#instruction-quality-evidence-and-limits).

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
