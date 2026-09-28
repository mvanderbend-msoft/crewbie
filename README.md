<div align="center">

# Crewbie

### Agents implement. You review and architect.

[![CI](https://github.com/mvanderbend-msoft/crewbie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mvanderbend-msoft/crewbie/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mvanderbend-msoft/crewbie?include_prereleases&color=b11f4b)](https://github.com/mvanderbend-msoft/crewbie/releases)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[What you need](#what-you-need) &nbsp; / &nbsp;
[Quick start](#quick-start) &nbsp; / &nbsp;
[Your team](#your-team) &nbsp; / &nbsp;
[How it works](#how-it-works) &nbsp; / &nbsp;
[Principles](#principles) &nbsp; / &nbsp;
[Operations guide](docs/operations.md)

</div>

---

Crewbie turns the Copilot custom agents you already have into one team, and
adds a coordinator that runs the work. You write what you want in an issue.
The coordinator plans it, your agents build it as GitHub Copilot cloud agents,
and you review the result.

We are working towards a future where agents do the implementation work on
their own, and developers spend their time on review and architecture.
Crewbie covers only two steps of that work: **planning** and **implementation**.
It does not write your requirements and it does not deploy your code.

There is no framework to learn and no boilerplate to fill in. You use things
you already know: a GitHub issue, a label, a pull request review and a comment.

> [!IMPORTANT]
> **Alpha software.** Commands can still change. Crewbie works with GitHub
> Copilot only. Cloud runs use GitHub Actions minutes and Copilot AI credits.

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
- **Setup, planning and each agent session** use Copilot AI credits for the
  chosen model.
- Default limits: 2 agents at the same time, 3 tries per task and 20 launches
  per plan. You can change these in `.crewbie/config.json`. They limit launches,
  not money.

## Quick start

**1. Install the CLI**

```powershell
npm install --global --ignore-scripts https://github.com/mvanderbend-msoft/crewbie/releases/download/v0.1.0-alpha.47/crewbie-cli-0.1.0-alpha.47.tgz
```

**2. Set up your repository.** Run this inside your own project and review what
it proposes ([what init does](#what-crewbie-init-does)):

```powershell
crewbie init
```

**3. Commit and push** the files init created to your default branch.

**4. Do the one-time [GitHub setup](#in-your-github-repository)**, including the
`CREWBIE_USER_TOKEN` secret.

**5. Open an issue** with your first feature and add `crewbie:ready-for-planning`.

## Your team

### What `crewbie init` does

Init first reads your repository and **assesses the AI artifacts you already
have**:

- Custom agents in `.github/agents/`
- `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`
  and `AGENTS.md`
- MCP configuration (the settings only; servers are not started)
- Existing decision records or principles documents

Each file gets a clear verdict: **keep**, **edit** (with the exact new text) or
**defer** (with the reason). Init also flags common problems, such as advice
repeated in several files, broken links, outdated commands and generic advice an
agent could work out from the code.

Everything goes into a report, `crewbie-setup.md`. **Nothing is written until
you approve it.** You choose to apply only the team, the team plus the
suggested instruction edits, or just save the report. Init does not run your
scripts or tests.

### Existing repository: your agents become the team

In a brownfield repository, Crewbie **reuses your existing custom agents**:

- Each agent becomes a team member with the same instructions, tools and
  description. Nothing you wrote is cut or rewritten. The original file is kept
  as a backup in `.crewbie/agent-archive/`.
- Crewbie adds a **coordinator** agent. It plans each issue, gives each task to
  the right agent and sets the order.
- Crewbie adds a new role only when there is a clear gap, such as nobody owning
  tests. It gives a reason, and you decide.

### New repository: a team is assembled

In a greenfield repository with no agents yet, describe what you want to build.
Init asks follow-up questions when needed and then proposes a full team that
fits the project, for example:

| Role | Does |
|---|---|
| **Coordinator** | Splits your issue into tasks and picks an owner for each. |
| **Frontend / backend engineers** | Build the UI and the API. |
| **Tester** | Checks the combined work against your acceptance criteria. |
| **Reviewer** | Reviews the feature PR and points out problems. |

In both cases each role is a normal GitHub custom agent in `.github/agents/`
with its own model, and you can edit it like any other file. An optional
**improver** can suggest small memory and instruction updates at night.
When your project changes, `crewbie init --update` looks again and suggests
team changes without resetting what you approved.

## How it works

```text
You write an issue ──► add label ──► coordinator opens a plan PR ──► you approve and merge it
                                                                             │
          you merge the feature PR ◄── Crewbie review ◄── agents build tasks ◄┘
```

1. **Write the issue.** Put your PRD, spec or plain description in a GitHub issue.
2. **Add the label `crewbie:ready-for-planning`.** The coordinator splits the
   work into small tasks and gives each task to one of your agents.
3. **Review the plan PR.** It shows the tasks, owners and order. Reply on the PR
   to answer questions, or comment `/crewbie revise <feedback>` to change it.
4. **Approve and merge the plan PR.** This is your go-ahead. Crewbie creates one
   issue per task and assigns each to its Copilot cloud agent.
5. **Agents build.** Each task gets its own PR into a shared feature branch.
   When its checks pass, Crewbie merges it there and starts the next task.
6. **Review the feature PR.** When all tasks are done, Crewbie opens one feature
   PR into your default branch and the reviewer agent comments on it. Comment
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
until they are needed. Every memory change goes through a PR you review.
GitHub also loads your own `.github/copilot-instructions.md` and `AGENTS.md`
for each agent, as usual.

## Principles

| Principle | In practice |
|---|---|
| **You own the what and the why.** | You write the requirements and make the architecture choices. Agents do the implementation. |
| **Nothing new to learn.** | Issues, labels, PRs and comments. No new document types or process steps. |
| **Reuse what you have.** | Your existing agents and instructions become the team. Crewbie adds a coordinator, not boilerplate. |
| **People decide.** | You approve the setup and the plan, and you merge the feature. Crewbie merges only task PRs, and only into the feature branch. |
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

Planning locally instead of on GitHub, the review loop, Azure DevOps work items,
nightly learning and recovery steps are all in the
[operations guide](docs/operations.md).

<details>
<summary><strong>What gets added to my repository?</strong></summary>

```text
.github\agents\crewbie-*.agent.md       One agent per role (your adopted agents plus the coordinator)
.github\skills\crewbie\SKILL.md         Local workflow for Copilot CLI
.github\workflows\crewbie-*.yml         Planning, dispatch, review, fixes and reports
.crewbie\config.json                   Team, models and limits
.crewbie\instructions.md               Shared working rules
.crewbie\decisions\hot.md              Shared decisions
.crewbie\decisions\index.md            Links to older shared decisions
.crewbie\team\<role>\hot.md            Role lessons
.crewbie\team\<role>\index.md          Links to older role notes
.crewbie\agent-archive\                Backups of your original agent files
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
