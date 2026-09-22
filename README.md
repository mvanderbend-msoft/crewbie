# Crewbie

**A small crew, not a big process.** Crewbie adds specialist agents to existing
GitHub repositories without introducing a new agent runtime or a long document
chain. Local specification uses Copilot CLI; implementation uses named GitHub
cloud agents.

**Status: alpha.** Local flows and remote request contracts are covered by
automated fixtures. Live account entitlements, GitHub's preview assignment
interface, and hosted workflows still need verification in your repository.
Nothing silently switches to a generic agent or a different model.

## Install the alpha

Requires Node.js 22 or newer and Git. Install the prebuilt package from the
[GitHub release](https://github.com/mvanderbend-msoft/crewbie/releases/tag/v0.1.0-alpha.0):

```powershell
npm install --global --ignore-scripts https://github.com/mvanderbend-msoft/crewbie/releases/download/v0.1.0-alpha.0/crewbie-cli-0.1.0-alpha.0.tgz
```

This alpha is distributed through GitHub Releases, **not npm**. Do not use
`npx @crewbie/cli` or install an unverified similarly named package. The release
includes a SHA-256 checksum. Installation does not launch agents or enable paid
runs.

For local GitHub orchestration, install GitHub CLI and authenticate with
`gh auth login`. Local specification also needs an authenticated Copilot CLI.
Cloud specialists require an eligible Copilot account and repository access;
see the [capability matrix](docs/operations.md#account-and-runtime-capability-matrix).

Alternatively, build from source:

```powershell
git clone https://github.com/mvanderbend-msoft/crewbie.git
cd crewbie
npm ci
npm test
npm pack
```

Use `node C:\path\to\crewbie\dist\cli.js` below, or install the generated tarball:

```powershell
npm install --global .\crewbie-cli-0.1.0-alpha.0.tgz
```

## Start in an existing project

Run this from the project you want your crew to work on, not the Crewbie source
repository:

```powershell
crewbie init --out crewbie-setup.json
```

This only inspects files. It reports readiness gaps and questions; it does not
execute your scripts or change project policy. Open the project in Copilot CLI
and use the Crewbie skill after installation, or ask it to review the proposal
against representative code, tests and existing guidance.

Review `crewbie-setup.json`. Choose the GitHub repository, human approvers,
specialists and explicit models. Reuse an existing constitution or supply a
short `constitutionText` and its path. Optional `instructions` entries contain
`path`, `content`, and `beforeHash` (`null` for a new file). Existing files need
their exact SHA-256 in `beforeHash` or the proposal's `adopt` map before Crewbie
may take over updates. Declining a new constitution is supported.

The proposed crew includes repository-specific implementation roles, a tester and
a reviewer, alongside the coordinator and improver. Each has a distinct charter
and its own hot/index memory. Remove unnecessary roles during review; defining a
team does not launch every member for every task. The improver is provisioned even
when scheduled learning is disabled.

Charters contain subject-specific checks and non-negotiables: frontend state,
accessibility and browser recovery differ from backend contracts, transactions
and persistence. Shared scope/learning rules live once in
`.crewbie/instructions.md`. Optional role `checks` and `nonNegotiables` arrays
add reviewed repository-specific guidance without copying a generic charter.

Assessment also reports **instruction quality**, inspired by
[Gloaguen et al. (2026)](https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd).
It flags copied README passages, repeated specialist boilerplate, generic-only advice, unverified local links,
missing npm script references and apparently unconditional full-suite work.
Each signal has a file/line, explanation and recommendation. These are advisory
heuristics, not findings proven harmful by the paper, a maturity score, or permission
to rewrite policy. File length alone is not a quality warning. Inspection limits
are disclosed, and no project command is executed.

```powershell
crewbie init --proposal crewbie-setup.json
crewbie init --proposal crewbie-setup.json --apply
```

The first command previews complete changes. Installation preserves existing
guidance and stops on edited-file conflicts. `--update` uses the same preview
and ownership checks; it does not overwrite human edits.

## Specify, approve, deliver

Use the installed `crewbie` skill in Copilot CLI. It asks focused questions,
writes a short spec, and proposes small tasks with owners and dependencies.
See `examples\batch.json` for the machine-readable contract.

```powershell
crewbie status --source requirements.md
crewbie status --batch batch.json
crewbie approve --batch batch.json --yes --execute
crewbie publish --batch batch.json
crewbie publish --batch batch.json --apply
```

Approve publication without `--execute` if implementation must wait. Changing
scope, source content, ownership, model or dependencies requires reapproval.
Preview and approval never launch a session.

After installing and configuring the Actions workflows, publication explicitly
requests dispatch. The dispatcher validates trusted approval, follows prerequisite
links and limits active work. A `ready` label alone grants nothing. Only a merged
linked PR releases dependent tasks; failures and uncertain launches require
human attention.

Implementation dependencies require merged PRs. Explicit `kind: "review"` tasks
can instead depend on verified completed sessions with linked reviewable PRs.
That distinction is part of the approved task graph, not inferred from a title.

For local orchestration with your authenticated GitHub CLI account, use
`publish --batch batch.json --apply --dispatch-local`. The same approval, claims
and capacity checks launch native cloud specialists, without storing an assignment
credential in Actions. This flag does not grant execution consent.

Add `--watch` to keep that command reconciling automatically:

```powershell
crewbie publish --batch batch.json --apply --dispatch-local --watch
```

It releases newly eligible specialists and stops when the batch reaches cloud
handoff, needs human action, or times out (one hour by default). It never merges
PRs, retries uncertain assignments, or launches another batch. Repository-wide
capacity still applies. A completed session is not a claim that CI or review passed.

For **autonomous review and correction**, approve a small review plan identifying
the reviewer issue, target issue/PR pairs, exact issue digests, allowed correction
paths and a `maxRounds` budget (1-5). Then preview and apply:

```powershell
crewbie publish --review-loop review.json
crewbie publish --review-loop review.json --apply --watch
```

The named reviewer produces a pinned-head report. Crewbie posts it as real GitHub
PR reviews, sends required changes to each original specialist on its existing
branch, and re-reviews the corrected heads. Specialist attribution is maintained
in PR descriptions. Reviews are explicitly attributed to the cloud reviewer even
when the authorized coordinator publishes them; they are not human approval.
The loop keeps one reviewer report PR and stops on a clean result, a blocker,
an uncertain launch, timeout or the correction budget. It never merges.
This opt-in mode uses the documented Agent Tasks API for same-branch continuations,
which currently requires an eligible Business/Enterprise seat and user-authorized
Agent Tasks access; issue-assignment eligibility alone does not establish support.
See the review-plan format and recovery details in [operations](docs/operations.md).

## Memory and improvement

The agent profile is its charter. Each role reads shared decisions and its own
small hot file/index, loading cold/archive topics only when relevant.
When the approved issue scope allows it, specialists propose durable history
updates as file changes in their implementation/review PR. Shared decisions change
only for new cross-role choices, not as an activity log. If memory is out of scope,
a short marked PR comment carries the proposal to nightly review. No useful new
lesson means no forced file change.

```powershell
crewbie status --memory developer
crewbie status --memory developer --topic shared/cold/storage-choice.md
```

Nightly learning is opt-in. A constrained Copilot CLI analysis proposes
evidence-linked guidance changes in one human-reviewed PR. The improver has its
own memory. Decisions and legacy exceptions are not silently rewritten.
Preparation, tool-free AI analysis and guarded publication run in separate Actions
jobs with scoped built-in tokens. No personal token is needed for this workflow;
account entitlement and Copilot billing policy still apply.

## Usage dashboard

```powershell
crewbie dashboard --collect --out crewbie-dashboard.html
crewbie dashboard --records examples\runs.json --out example-report.html
```

The self-contained report filters specialists, models and dates. It separates
requested from observed models and shows missing measurements as **unknown**.
Collected issue records are not an exhaustive session/billing ledger. Exact
cloud tokens and spend cannot be invented from organization totals.

Hosted reports default to a repository-access-controlled Actions artifact.
Private Pages requires the right GitHub plan; public hosting is explicit opt-in.

See [operations](docs/operations.md) for credentials, ADO, deployment, recovery,
and the account capability matrix. Registry publishing and live cloud runs are
not performed by installation.

MIT licensed. Inspired by [Spec Kit](https://github.com/github/spec-kit) and
[Brady Gaster's Squad](https://github.com/bradygaster/squad), with an original,
smaller implementation. Crewbie is a working name pending branding clearance.
