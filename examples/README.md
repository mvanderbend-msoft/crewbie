# Worked examples

Each example is a fictional repository that has used Crewbie for two months, from `crewbie init` on 2026-08-24 to 2026-10-23.
They show what the team looks like, what the agents remember, which decisions they share, how issues became plans and
PRs, and what reviews caught along the way.

| Example | Repository | Team |
| --- | --- | --- |
| [.NET modernisation](dotnet-modernisation/) | ASP.NET MVC 5 on .NET Framework 4.8, moving route by route to ASP.NET Core on .NET 10 and Azure Container Apps | web-migration, data-access, cloud-platform, migration-reviewer |
| [Foundry hosted agents](foundry-hosted-agents/) | Python Microsoft Agent Framework agent hosted in Microsoft Foundry, deployed with azd | agent-runtime, evaluation, foundry-platform, agent-reviewer |
| [Java 21 upgrade](java-21-upgrade/) | Maven multi-module service moving from Java 11 to Java 21 without changing frameworks; adopts an existing custom agent | build-platform, ledger-domain, persistence, ledger-reviewer |

## What each example contains

- `README.md`: the project, why this team, and a tour of where to look.
- `HISTORY.md`: the two months as a timeline of issues, plan PRs, task PRs, reviews, `/crewbie fix` rounds and the memory
  each PR added.
- `setup/crewbie-setup.md`: what init proposed on day 0.
- `project/`: the repository today. It contains the application code, `.crewbie/config.json`, the `crewbie-*` agents,
  instructions, the Crewbie workflows, agent memory under `.crewbie/team/`, shared decisions under `.crewbie/decisions/`,
  and every plan under `.crewbie/plans/`.
- `scenario.mjs`: the repository before init, the Crewbie Compass answers, the review Copilot returned, and the issues
  planned since.

## Generated vs hand-written

Crewbie's own code generates everything Crewbie owns: the init assessment, config, agents, instructions, workflows,
skill, PR template, `docs/destination.md` and each plan's `plan.md`, `batch.json` and `setup.json`. `generate.mjs` builds
the pre-init repository in a temporary Git repository, runs Crewbie's assessment, review validation and installer, then
runs the planning output parser on each issue. A scenario that would show repository warnings in init does not generate.

The application code, memory, decisions, history and the few files the team changed on purpose are written by hand to
show two months of use. Changed files are listed with a reason in `evolved` in `scenario.mjs`. Plans omit the
run-specific `execution.json`.

`test/examples.test.mjs` checks the generated files are current. It also checks:

- Every plan parses against the team's config.
- Memory stays within Crewbie's word budgets.
- Every memory entry cites a PR or issue that appears in the history.
- Every memory index link resolves.

```sh
npm run examples                      # regenerate all
npm run build && node examples/generate.mjs java-21-upgrade
```

Model IDs come from a fixed sample catalog in `generate.mjs`. Real init offers the models your Copilot account lists.

`batch.json` and `runs.json` in this folder are minimal file formats for `crewbie approve` and `crewbie run`, not worked examples.
