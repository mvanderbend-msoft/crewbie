# Worked examples

Each example shows what Crewbie produces for a realistic repository: the team and guidance `crewbie init` installs, a sample issue, and the plan the coordinator turns it into.

| Example | Repository | Team |
| --- | --- | --- |
| [.NET modernisation](dotnet-modernisation/) | ASP.NET MVC 5 on .NET Framework 4.8, moving route by route to ASP.NET Core on .NET 10 and Azure Container Apps | web-migration, data-access, cloud-platform, migration-reviewer |
| [Foundry hosted agents](foundry-hosted-agents/) | Python Microsoft Agent Framework agent hosted in Microsoft Foundry, deployed with azd | agent-runtime, evaluation, foundry-platform, agent-reviewer |
| [Java 21 upgrade](java-21-upgrade/) | Maven multi-module service moving from Java 11 to Java 21 without changing frameworks; adopts an existing custom agent | build-platform, ledger-domain, persistence, ledger-reviewer |

## What each example contains

- `scenario.mjs`: the repository before init (stub files), the Crewbie Compass answers, the review Copilot returned, the sample issue and the coordinator's task breakdown.
- `crewbie-setup.md`: the assessment init shows for review.
- `repo/`: the files init writes that are specific to the repository. These are the team in `.crewbie/config.json`, the `crewbie-*` specialist agents, instructions, the constitution if there is one, `copilot-setup-steps.yml`, `.vscode/mcp.json` and `docs/destination.md`.
- `issue.md`: a feature request as a human would write it.
- `plan.json`: the batch the planning PR commits to `.crewbie/plans/issue-<n>/batch.json`. Merging the planning PR approves it and starts the tasks.

The standard files are omitted from `repo/` because every installation gets them unchanged. These are the `crewbie-*` workflows, the `crewbie` skill, the coordinator and improver agents, the PR template, `.crewbie/instructions.md`, and the memory files under `.crewbie/team/` and `.crewbie/decisions/`.

## How they are made

The outputs are not hand-written. `generate.mjs` builds each stub repository in a temporary Git repository. It runs Crewbie's own assessment, review validation, installer and planning parser on it, and writes the result. A scenario that would show repository warnings in init, such as a path that does not exist or an unowned workspace, fails to generate. `test/examples.test.mjs` fails when a committed example differs from what the current code produces.

```sh
npm run examples                      # regenerate all
npm run build && node examples/generate.mjs java-21-upgrade
```

Model IDs come from a fixed sample catalog in `generate.mjs`. Real init offers the models your Copilot account lists.

`batch.json` and `runs.json` in this folder are minimal file formats for `crewbie approve` and `crewbie run`, not worked examples.
