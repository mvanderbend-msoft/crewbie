<div align="center">

# Crewbie

### Agents implement. You review and architect.

[![CI](https://github.com/mvanderbend-msoft/crewbie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mvanderbend-msoft/crewbie/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@crewbie/cli?color=b11f4b)](https://www.npmjs.com/package/@crewbie/cli)
[![Release](https://img.shields.io/github/v/release/mvanderbend-msoft/crewbie?include_prereleases&color=b11f4b)](https://github.com/mvanderbend-msoft/crewbie/releases)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[How it works](#how-it-works) &nbsp; / &nbsp;
[What you need](#what-you-need) &nbsp; / &nbsp;
[Quick start](#quick-start) &nbsp; / &nbsp;
[Principles](#principles) &nbsp; / &nbsp;
[Operations guide](docs/operations.md)

</div>

---

Crewbie gives your GitHub repository a small team of GitHub Copilot cloud
agents. You write what you want in an issue. Crewbie plans the work, the agents
build it, and you review the result.

We are working towards a future where agents do the implementation work on
their own, and developers spend their time on review and architecture.
Crewbie covers only two steps of that work: **planning** and **implementation**.
It does not write your requirements and it does not deploy your code.

There is no framework to learn and no boilerplate to fill in. You use things
you already know: a GitHub issue, a label, a pull request review and a comment.

> [!IMPORTANT]
> **Alpha software.** Commands can still change. Crewbie works with GitHub
> Copilot only. Cloud runs use GitHub Actions minutes and Copilot AI credits.

## See it in action

A real run in a demo repo, with waiting time cut out: an issue with one label
becomes a plan, the plan becomes agent work, and the result is merged to `main`.

[![Crewbie turning a labelled issue into a plan, agent work and a merged change](https://raw.githubusercontent.com/mvanderbend-msoft/crewbie/main/.github/assets/crewbie-demo.gif)](https://github.com/user-attachments/assets/1cb92557-9156-4bfb-ac47-89c453932c23)

Shown at double speed. [Watch the full-speed video](https://github.com/user-attachments/assets/1cb92557-9156-4bfb-ac47-89c453932c23).

## How it works

```text
You write an issue ──► add label ──► Crewbie opens a plan PR ──► you approve and merge it
                                                                         │
      you merge the feature PR ◄── Crewbie review ◄── agents build tasks ◄┘
```

1. **Write the issue.** Put your PRD, spec or plain description in a GitHub issue.
2. **Add the label `crewbie:ready-for-planning`.** The coordinator agent splits
   the work into small tasks and gives each task to a specialist.
3. **Review the plan PR.** It shows the tasks, owners and order. Reply on the PR
   to answer questions, or comment `/crewbie revise <feedback>` to change it.
4. **Approve and merge the plan PR.** This is your go-ahead. Crewbie creates one
   issue per task and assigns each to its Copilot cloud agent.
5. **Agents build.** Each task gets its own PR into a shared feature branch.
   When its checks pass, Crewbie merges it there and starts the next task.
6. **Review the feature PR.** When all tasks are done, Crewbie opens one feature
   PR into your default branch and its reviewer agent comments on it. Comment
   `/crewbie fix` to send the review findings back to the agents.
7. **You merge.** Crewbie never merges into your default branch.

**That is the whole interface:**

| You do | Where |
|---|---|
| Add `crewbie:ready-for-planning` | On an issue, to start planning |
| Reply, or `/crewbie revise <feedback>` | On a plan PR, to change the plan |
| Approve and merge | On a plan PR, to start the work |
| `/crewbie fix [notes]` | On a feature PR, to fix review findings |
| Add `crewbie:restart` | On a task issue, to retry a failed start |
| Merge | On the feature PR, when you are happy |

The other `crewbie:*` labels show status. Crewbie sets them for you.

## What you need

### On your computer

- **Node.js 22.12+**, **Git** and the **GitHub CLI** (`gh auth login`).
- A **GitHub Copilot plan that includes the Copilot cloud agent**. Organization
  repositories also need the cloud agent allowed by the organization's policy.

### In your GitHub repository

Do this once per repository. `crewbie init` creates the labels and the
`CREWBIE_COPILOT_VERSION` variable for you.

| Setting | Where | Why |
|---|---|---|
| Copilot cloud agent available | *Settings → Copilot → Cloud agent* | Agents run as Copilot cloud agent sessions. |
| **Require approval for workflow runs**: off | *Settings → Copilot → Cloud agent* | Otherwise GitHub holds each finished session and the next task waits up to an hour. |
| **Allow GitHub Actions to create and approve pull requests**: on | *Settings → Actions → General → Workflow permissions* | Crewbie's workflows open the plan and feature PRs. |
| Actions enabled | *Settings → Actions → General* | Planning, dispatch and review run as workflows. |
| Secret `CREWBIE_USER_TOKEN` | *Settings → Secrets and variables → Actions* | Assigns tasks to Copilot. GitHub only allows this with a user token, not the built-in Actions token. |

For `CREWBIE_USER_TOKEN`, create a fine-grained personal access token for this
repository, owned by a user with write access, with:

- **Read:** Metadata, Agent tasks
- **Read and write:** Actions, Contents, Issues, Pull requests

```powershell
gh secret set CREWBIE_USER_TOKEN --repo OWNER/REPO   # paste the token when asked
```

Never put the token in a file, an issue or a command argument. See
[credentials](docs/operations.md#human-approval-and-credentials) for details.

### What it costs

- **Planning, review and dispatch** run on GitHub Actions and use Actions minutes
  (free for public repositories).
- **Each agent session** uses Copilot AI credits for the chosen model.
- **Save tokens with a setup workflow.** Every step an agent takes resends its
  whole context. Add `.github/workflows/copilot-setup-steps.yml` to install your
  dependencies before the agent starts; otherwise each session spends turns
  installing them. `crewbie init` tells you when it is missing.
- Default limits: 2 agents at the same time, 3 tries per task and 20 launches
  per plan. You can change these in `.crewbie/config.json`. They limit launches,
  not money.

## Quick start

**1. Install the CLI**

```powershell
npm install --global @crewbie/cli
```

Install it globally so the `crewbie` command is on your PATH. If you install it
into a project without `--global`, run it with `npx crewbie` instead. The
package is on [npm](https://www.npmjs.com/package/@crewbie/cli).

If you can't use the public npm registry, for example because of a company
registry, install the package file from the
[GitHub release](https://github.com/mvanderbend-msoft/crewbie/releases) instead:

```powershell
npm install --global --ignore-scripts https://github.com/mvanderbend-msoft/crewbie/releases/download/v0.1.0-alpha.51/crewbie-cli-0.1.0-alpha.51.tgz
```

Each release also includes a `SHA256SUMS` file to check the download.

**2. Set up your repository.** Run this inside your own project:

```powershell
crewbie init
```

Crewbie looks at your code and your existing instructions and agents. It then
proposes a team, such as a frontend engineer, a backend engineer and a
reviewer, with a model for each. You review the proposal before anything is
written. For a new project, describe what you want to build and init asks
follow-up questions.

**3. Commit and push** the files init created to your default branch.

**4. Do the one-time [GitHub setup](#in-your-github-repository)**, including the
`CREWBIE_USER_TOKEN` secret.

**5. Open an issue** with your first feature and add `crewbie:ready-for-planning`.

## What init checks in your instructions

Init reviews every instruction file and custom agent it finds. It then proposes
edits for you to approve. It checks for the six configuration smells from
[*Configuration Smells in AGENTS.md Files*](https://arxiv.org/abs/2606.15828),
a study of 100 popular repositories:

| Smell | What it is | How Crewbie finds it |
|---|---|---|
| **Lint leakage** | Style rules a linter or formatter already enforces, such as indentation, quotes or line length | Static check. Warns when a linter or formatter config exists; otherwise suggests adding one |
| **Context bloat** | Always-loaded guidance over 200 lines | Static check, following Anthropic's 200-line recommendation. Proposed edits must stay within it. Change it with `limits.guidanceLines` |
| **Skill leakage** | Step-by-step instructions for rare tasks in always-loaded guidance | Model review. Suggests moving them to a skill |
| **Conflicting instructions** | Two rules that cannot both be followed | Model review. Names both lines |
| **Init fossilization** | A file committed once and never updated while the code kept changing | Static check against Git history |
| **Blind references** | A path to a document with no word on what it holds or when to read it | Static check. Asks for one explaining line |

Crewbie also checks for:

| Check | What it flags |
|---|---|
| Generic advice | Files or agent charters with only advice such as "write clean code" |
| Duplicated documentation | Passages copied from README or CONTRIBUTING |
| Shared boilerplate | The same block repeated across custom agents |
| Pointers to auto-loaded files | "Read AGENTS.md" and similar lines. Copilot already loads those files |
| Agent-only context | A document only one agent is told to read, which is better as path-scoped instructions |
| Broken links and paths | Links, paths and agents that point to files that no longer exist |
| Wrong commands | `npm run` scripts that do not exist, or have no `package.json` in scope |
| Always running every test | Rules that run the whole test suite on every change, outside merge or release gates |
| Invalid scope | `.instructions.md` files without valid `applyTo` globs |

The static checks are hints for the review, not a score. Init reports every
finding as retain, edit or defer, and nothing is written until you approve it.

## The team

The team fits your repository; there is no fixed list of roles. A typical web app
might get:

| Role | Does |
|---|---|
| **Coordinator** | Splits your issue into tasks and picks an owner for each. |
| **Frontend / backend engineers** | Build the UI and the API. |
| **Tester** | Checks the combined work against your acceptance criteria. |
| **Reviewer** | Reviews the feature PR and points out problems. |
| **Improver** | Optional. Suggests small memory and instruction updates at night. |

Each role is a normal GitHub custom agent in `.github/agents/`. You can edit it
like any other file.

## Memory

Agents keep short notes in Git so the next task does not repeat old mistakes.

| File | Holds | Used |
|---|---|---|
| `.crewbie/team/<role>/hot.md` | Current lessons and pitfalls for that role | Every task |
| `.crewbie/decisions/hot.md` | Choices that several roles depend on | Every task |
| `index.md` next to each | Links to older notes | Every task, as a table of contents |
| `cold/` and `archive/` | Older notes | Only when a task needs that history |

Crewbie puts the hot files and indexes straight into each agent's start-up
instructions, so the agent always has them. Older notes stay out of the way
until they are needed. When a hot file grows past its word budget, Crewbie
moves the oldest entries to a linked `cold/` note. It never blocks a PR for
this. Every memory change goes through a PR you review.
GitHub also loads your own `.github/copilot-instructions.md` and `AGENTS.md`
for each agent, as usual.

Each entry is a rule with its reason, plus where it came from in an HTML
comment:

```markdown
- Seed data resets on restart, so tests create users. <!-- source: #42 2026-09-29 -->
```

Agents doing the work need the reason to apply the rule, so the reason is
visible. The source only matters when deciding whether an entry is stale, so
Crewbie removes comments before memory reaches implementers and the reviewer,
and does not count them toward word budgets. The agents that rewrite memory
(the planner for shared decisions, the nightly improver) see the comments.
This follows research showing that instructions without their reasoning are
rarely pruned and pile up ([arXiv:2608.11095](https://arxiv.org/abs/2608.11095)).

## Principles

| Principle | In practice |
|---|---|
| **You own the what and the why.** | You write the requirements and make the architecture choices. Agents do the implementation. |
| **Nothing new to learn.** | Issues, labels, PRs and comments. No new document types or process steps. |
| **Fit the repository.** | Crewbie reuses your existing instructions, agents and tests instead of adding its own boilerplate. |
| **People decide.** | You approve the plan and merge the feature. Crewbie merges only task PRs, and only into the feature branch. |
| **Stop rather than guess.** | Clear launch limits, no silent retries and no silent switch to another agent or model. |
| **Remember lessons, not transcripts.** | Small hot files, with older detail moved out of the way. |
| **Be honest about what is known.** | Crewbie shows the model it asked for and says when it cannot confirm which model ran. Unknown usage is shown as unknown, not zero. |

### Trade-offs to know about

- **GitHub and Copilot only.** Other agent tools and Git hosts are not supported.
- **Your tests matter.** Agents check their work with your build and tests. Weak
  tests mean weaker checks.
- **Parallel tasks can conflict.** Two tasks that change the same file may need
  a manual fix.
- **Not tested everywhere.** It has been run on a few accounts and repositories,
  not on every organization policy.

## Useful commands

| Command | Does |
|---|---|
| `crewbie update` / `crewbie update --apply` | Refresh the workflows and agents after installing a new CLI version. Your team, models and memory stay as they are. |
| `crewbie init --update` | Look at the repository again and suggest team changes. |
| `crewbie test <feature>` | Check out a feature branch locally and start your app. |
| `crewbie preflight` | Show what would launch next. |
| `crewbie pause --apply` / `crewbie resume --apply` | Stop and restart new launches. Running sessions continue. |
| `crewbie dashboard --collect --out report.html` | Build a report of who did what, with which model. |
| `crewbie eval --guided owner/a --bare owner/b` | Compare two sandboxes that ran the same plan with and without your guidance: tasks merged and tokens per merged task. |

To cap spend per feature, set `execution.maxTokensPerFeature` in
`.crewbie/config.json`; launches stop once the plan's task PRs reach it.

Planning locally instead of on GitHub, the review loop, Azure DevOps work items,
nightly learning and recovery steps are all in the
[operations guide](docs/operations.md).

<details>
<summary><strong>What gets added to my repository?</strong></summary>

```text
.github\agents\crewbie-*.agent.md       One agent per role
.github\skills\crewbie\SKILL.md         Local workflow for Copilot CLI
.github\workflows\crewbie-*.yml         Planning, dispatch, review, fixes and reports
.crewbie\config.json                   Team, models and limits
.crewbie\instructions.md               Shared working rules
.crewbie\decisions\hot.md              Shared decisions
.crewbie\decisions\index.md            Links to older shared decisions
.crewbie\team\<role>\hot.md            Role lessons
.crewbie\team\<role>\index.md          Links to older role notes
.crewbie\rationale.md                  Why nightly learning changed each rule (after the first improvement merges)
```

Plans are added under `.crewbie\plans\` by each plan PR. Crewbie tracks which
files it owns and stops instead of overwriting your edits.

</details>

## Build and contribute

```powershell
git clone https://github.com/mvanderbend-msoft/crewbie.git
cd crewbie
npm ci --ignore-scripts
npm test
```

Keep changes small and cover behaviour changes with tests. Maintainer release
steps are in the [operations guide](docs/operations.md#verification-and-release).
Report problems in [GitHub issues](https://github.com/mvanderbend-msoft/crewbie/issues).

---

**MIT licensed.** Inspired by [Brady Gaster's Squad](https://github.com/bradygaster/squad).
Crewbie is a separate, smaller project, not a fork.
