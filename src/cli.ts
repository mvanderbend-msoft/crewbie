#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { hash, integer, json, optionalText, readJson, record, safePath, string, writeAtomic } from "./core.js";
import { limitsFor, loadConfig } from "./config.js";
import { probeCapabilities, renderReport } from "./execution/capabilities.js";
import { githubReader } from "./execution/github.js";
import { dispatch, eligible, inspectWork, preflight, renderDispatchResult } from "./execution/dispatch.js";
import { baselineLaunches, setLaunchPause } from "./execution/controls.js";
import { cancelRun } from "./execution/cancel.js";
import { watchBatch } from "./execution/watch.js";
import { parseReviewPlan, reconcileReview, watchReviews } from "./execution/review-loop.js";
import { initCommand } from "./setup/init.js";
import { updateRepository } from "./setup/update.js";
import { approvedBatch, parseBatch, requireApproval } from "./specification/batch.js";
import { preparePlanning, publishPlanning, requestPlanningRevision } from "./specification/planning.js";
import { releaseMergedPlan } from "./execution/planning-approval.js";
import { checkPrDescription } from "./specification/prose.js";
import { api, requireApprover } from "./tracking/github.js";
import { publish, publishDescription } from "./tracking/issues.js";
import { adoApi, createWorkItem, importWorkItem, linkAdo, syncAdo, writeBack } from "./tracking/ado.js";
import { verifySources } from "./tracking/sources.js";
import { memoryContext } from "./memory/context.js";
import { applyMaintenance, prepareMaintenance } from "./memory/runner.js";
import { dashboard } from "./reporting/dashboard.js";
import { collectRecords, parseRecords } from "./reporting/records.js";
import { collectPrUsage, renderPrUsage } from "./reporting/pr-usage.js";
import { createOutput } from "./presentation.js";

const HELP = `Crewbie: a project-specific AI implementation crew.

USAGE
  crewbie <command> [options]

SETUP AND GUIDANCE
  init [--model MODEL] [--out setup.json]          LLM assessment, tailored team and approval
    --model-policy cost-aware|fixed               New specialists: reviewed catalog choices (default cost-aware)
    --specialist-model MODEL                      Explicit new-specialist model override
    --model-profile economy|balanced|quality      Capability-aware selection (default balanced)
    --description "project intent"                Greenfield context; asks again when unclear
    --repo owner/name --approver LOGIN             Setup repository and human approvers
  init --assessment-only [--out setup.json]        Offline inventory; no LLM
  init --update --out team.json                   Reassess an installed crew without resetting policy
  init --proposal setup.json --apply --guidance apply|skip
                                                 Install reviewed team and GitHub labels
    --skip-labels                                Explicit offline setup; no GitHub writes
  init --proposal setup.json --update             Preview safe managed-file upgrades
    --json                                       Machine-readable installation preview
  update [--apply] [--offline] [--json]            Update repository integration without AI reassessment

PLANNING AND EXECUTION
  revise-plan --pr N --feedback-file feedback.txt [--apply]
                                                 Preview/request one same-PR planning revision
  preflight [--batch-id ID] [--json]              Preview approvals, specialist/model and remaining launch limits
  pause | resume [--apply]                        Control future implementation/review launches, not running sessions
  cancel --issue N --run-id ID [--apply]           Preview/cancel an attributable cloud-agent Actions run
  budget --issue N --historical-attempts N [--apply]  Adopt reviewed pre-upgrade launch counts; never reset them
  approve --batch batch.json --yes [--execute]     Approve exact local scope
  publish --batch batch.json [--apply] [--ado-create] [--dispatch-local] [--watch]
    --watch [--timeout-seconds 3600] [--poll-seconds 30]  Reconcile until handoff
  publish --pr 123 --proposal handoff.json [--apply]  Preview/finalize PR metadata
  publish --review-loop review.json [--apply] [--watch]  Review, correct and re-review

STATUS AND REPORTS
  doctor --repo owner/name [--agent stem] [--model id] [--json]
  status --batch batch.json                       Validate a task/dependency graph
  status --source requirements.md                 Import text with a content revision
  status --issue 123 | --ado-id 456                Import a remote work item
  status --pr 123 [--json]                        Read observed token usage and coverage
  status --memory developer [--topic cold/name.md]
  status                                         Reconcile remote work read-only
  dashboard --records runs.json --out report.html
  dashboard --collect --out report.html

OUTPUT AND AUTHENTICATION
Terminal output uses grouped sections and responsive tables.
--json preserves machine-readable data on supported commands.
Redirected output stays plain; NO_COLOR disables terminal colours.
Use --path to select a local repository (default: current directory).
Paths supplied for input/output files are relative to that repository.
Remote commands use GH_TOKEN/GITHUB_TOKEN or authenticated GitHub CLI.
ADO uses CREWBIE_ADO_TOKEN. Never put tokens in command arguments.
Exit codes: 0 success; 1 error; 2 blocked capability. Unknown is not verified.
`;

function token(): string {
  const configured = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (configured) return configured;
  try {
    const value = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true,
    }).trim();
    if (!value) throw new Error("Empty credential.");
    return value;
  } catch {
    throw new Error("Set GH_TOKEN or authenticate GitHub CLI with gh auth login. Never put a token in a command argument.");
  }
}
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true, strict: true,
    options: {
      help: { type: "boolean", short: "h" }, path: { type: "string" }, repo: { type: "string" },
      agent: { type: "string" }, model: { type: "string" }, json: { type: "boolean" },
      "model-policy": { type: "string" }, "specialist-model": { type: "string" }, offline: { type: "boolean" },
      "model-profile": { type: "string" }, "batch-id": { type: "string" }, "run-id": { type: "string" },
      "historical-attempts": { type: "string" },
      out: { type: "string" }, proposal: { type: "string" }, apply: { type: "boolean" },
      update: { type: "boolean" }, batch: { type: "string" }, yes: { type: "boolean" },
      description: { type: "string" }, approver: { type: "string", multiple: true },
      guidance: { type: "string" }, "assessment-only": { type: "boolean" }, "skip-labels": { type: "boolean" },
      execute: { type: "boolean" }, source: { type: "string" }, issue: { type: "string" },
      "ado-id": { type: "string" }, "ado-create": { type: "boolean" },
      "dispatch-local": { type: "boolean" },
      watch: { type: "boolean" }, "timeout-seconds": { type: "string" }, "poll-seconds": { type: "string" },
      memory: { type: "string" }, topic: { type: "string", multiple: true },
      records: { type: "string" }, collect: { type: "boolean" }, prepare: { type: "boolean" },
      "pages-mode": { type: "string" },
      pr: { type: "string" },
      "feedback-file": { type: "string" },
      "review-loop": { type: "string" },
    },
  });
  const output = createOutput({ machine: values.json === true || positionals[0]?.startsWith("internal-") === true });
  if (values.help || positionals.length === 0) { output.text(HELP); return; }
  if (positionals.length !== 1) throw new Error("Choose exactly one command.");
  const command = positionals[0];
  if (command !== "init") output.heading(command!);
  if (values["review-loop"] && (command !== "publish" || values.batch || values.pr || values["dispatch-local"])) throw new Error("--review-loop requires publish and cannot be combined with batch/PR publication.");
  if (values.watch && (command !== "publish" || (!values["review-loop"] && (!values.batch || !values["dispatch-local"])))) throw new Error("--watch requires publish --batch and --dispatch-local, or publish --review-loop.");
  if (!values.watch && (values["timeout-seconds"] !== undefined || values["poll-seconds"] !== undefined)) throw new Error("Watch timing options require --watch.");
  const timeoutMs = integer(Number(values["timeout-seconds"] ?? 3600), "timeout seconds", 1, 86400) * 1000;
  const pollMs = integer(Number(values["poll-seconds"] ?? 30), "poll seconds", 1, 300) * 1000;
  if (command === "publish" && values.pr !== undefined && values.batch) throw new Error("Choose either batch publication or PR finalization, not both.");
  const root = resolve(values.path ?? ".");
  if (command === "init") {
    await initCommand(root, values, { client: () => api(token()), report: output.text });
    return;
  }
  if (command === "update") {
    output.text(await updateRepository(root, values, values.offline ? undefined : api(token())));
    return;
  }
  if (command === "doctor") {
    if (!values.repo) throw new Error("doctor requires --repo owner/repository.");
    const report = await probeCapabilities(githubReader(token()), {
      repository: values.repo, ...(values.agent === undefined ? {} : { agent: values.agent }),
      ...(values.model === undefined ? {} : { model: values.model }),
    });
    output.data(report, renderReport(report));
    if (report.findings.some((finding) => finding.status === "blocked")) process.exitCode = 2;
    return;
  }
  if (command === "status" && values.source) {
    if (!/\.(md|txt)$/i.test(values.source)) throw new Error("Source files must be Markdown or plain text. Convert Word/PDF outside Crewbie.");
    const path = await safePath(root, values.source);
    const content = await optionalText(path);
    if (content === null) throw new Error("Source file does not exist.");
    if (content.length > 1_000_000 || content.includes("\0")) throw new Error("Source is too large or not plain text. Split or convert it first.");
    output.data({ uri: values.source, revision: hash(content), text: content });
    return;
  }
  if (command === "dashboard" && values.records) {
    const records = parseRecords(await readJson(await safePath(root, values.records)));
    if (!values.out) throw new Error("Choose a report path with --out.");
    await writeAtomic(root, values.out, dashboard(records));
    output.text(`Report written to ${values.out}. Unavailable measurements remain unknown.`);
    return;
  }
  const config = await loadConfig(root);
  if (command === "budget") {
    if (!values.issue || !values["historical-attempts"]) throw new Error("Use budget --issue N --historical-attempts N; review historical attempts before --apply.");
    output.text(await baselineLaunches(api(token()), config, integer(Number(values.issue), "issue"), integer(Number(values["historical-attempts"]), "historical attempts"), values.apply === true));
    return;
  }
  if (command === "pause" || command === "resume") {
    output.text(await setLaunchPause(api(token()), config, command === "pause", values.apply === true));
    return;
  }
  if (command === "cancel") {
    if (!values.issue || !values["run-id"]) throw new Error("Use cancel --issue N --run-id ID; preview first, then --apply.");
    output.text(await cancelRun(api(token()), config, integer(Number(values.issue), "issue"), integer(Number(values["run-id"]), "run ID"), values.apply === true));
    return;
  }
  if (command === "preflight") {
    const report = await preflight(api(token()), config, values["batch-id"], undefined, config.ado ? adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "") : undefined);
    output.data(report, [report.notice, ...report.tasks.map((task) =>
      `#${task.issue} ${task.specialist} / ${task.model}: ${task.ready ? "READY" : "NOT READY"} - ${task.reason}\n  Approval: ${task.approved}; launches ${task.allowance.used}/${task.allowance.maxLaunchesPerBatch}; task attempts ${task.allowance.taskUsed}/${task.allowance.maxAttemptsPerTask}`)].join("\n"));
    return;
  }
  if (command === "revise-plan") {
    if (!values.pr || !values["feedback-file"]) throw new Error("Use revise-plan --pr N --feedback-file feedback.txt; --apply explicitly requests a potentially billable revision.");
    const feedback = await optionalText(await safePath(root, values["feedback-file"]));
    if (feedback === null) throw new Error("Feedback file does not exist.");
    output.text(await requestPlanningRevision(api(token()), config, integer(Number(values.pr), "planning PR"), feedback, values.apply === true));
    return;
  }
  if (command === "publish" && values["review-loop"]) {
    const plan = parseReviewPlan(await readJson(await safePath(root, values["review-loop"])));
    output.data({ repository: config.repository, plan, authorization: "Applying authorizes bounded review and same-specialist correction sessions, real GitHub reviews and metadata updates. No merges." });
    if (!values.apply) { output.text("Preview only. Review the exact issues, correction paths and round budget before --apply."); return; }
    const client = api(token());
    const ado = config.ado ? adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "") : undefined;
    if (values.watch) {
      const outcome = await watchReviews(client, config, plan, { timeoutMs, pollMs, progress: output.text, ...(ado ? { ado } : {}) });
      output.text(`Review loop: ${outcome}. No PRs were merged.`);
      if (outcome !== "clean") process.exitCode = 2;
    } else output.data(await reconcileReview(client, config, plan, ado));
    return;
  }
  if (command === "approve" || (command === "status" && values.batch) || (command === "publish" && values.pr === undefined)) {
    if (!values.batch) throw new Error("Choose a batch file with --batch.");
    const batchPath = await safePath(root, values.batch);
    const batch = parseBatch(await readJson(batchPath), config);
    if (command === "approve") {
      if (!values.yes) throw new Error("Review the spec, tasks, owner/model and prerequisites, then use --yes to record approval.");
      await writeAtomic(root, values.batch, json(approvedBatch(batch, values.execute === true)));
      output.text(`Approved exact batch ${batch.id}; execution ${values.execute ? "authorized" : "not authorized"}.`);
    } else if (command === "status") output.data(batch);
    else {
      requireApproval(batch);
      if (values.watch && !batch.approval?.execute) throw new Error("Watching requires execution approval.");
      output.data({ batch: batch.id, repository: config.repository, tasks: batch.tasks, createAdoWorkItems: values["ado-create"] === true, executionApproved: batch.approval?.execute, dispatch: values["dispatch-local"] ? "local" : "workflow" });
      if (!values.apply) { output.text("Preview only. Add --apply to publish the approved work."); return; }
      const github = api(token());
      await requireApprover(github, config.approvers);
      const ado = config.ado ? adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "") : undefined;
      await verifySources(batch.sources, github, config, ado);
      const adoMapping = new Map<string, number>();
      for (const task of batch.tasks) if (task.adoWorkItem) adoMapping.set(task.id, task.adoWorkItem);
      if (values["ado-create"]) {
        if (!config.ado) throw new Error("Configure the ADO organization, project, and work item type first.");
        const client = adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "");
        for (const task of batch.tasks) if (!adoMapping.has(task.id)) {
          const id = await createWorkItem(client, config.ado, batch, task);
          adoMapping.set(task.id, id);
          output.text(`ADO mapping confirmed: ${task.id} -> ${id}.`);
        }
      }
      if (adoMapping.size && !config.ado) throw new Error("Tasks reference ADO work items but the repository has no ADO integration policy.");
      const published = await publish(github, config, batch, ado, !values["dispatch-local"]);
      if (config.ado && adoMapping.size) {
        const client = adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "");
        for (const item of published) {
          const id = adoMapping.get(item.task);
          if (id) {
            await linkAdo(github, config, item.issue, id);
            await writeBack(client, id, [`https://github.com/${config.repository}/issues/${item.issue}`], `Crewbie execution issue created for ${item.task}.`);
          }
        }
      }
      output.data(published);
      if (values["dispatch-local"] && batch.approval?.execute) {
        const reconcile = async () => {
          const work = await dispatch(github, config, ado, { batch, issueNumbers: published.map((item) => item.issue) });
          if (ado) await syncAdo(github, ado, config, work);
          return work;
        };
        if (values.watch) {
          const result = await watchBatch(batch, reconcile, { timeoutMs, pollMs, progress: (work) => {
            output.data(work.map((item) => ({ issue: item.issue.number, task: item.metadata.task.id, state: item.state, reason: item.reason })));
          } });
          output.text(`Watch ${result.outcome} after ${result.rounds} reconciliation rounds. No PRs were merged.`);
          if (result.outcome !== "handoff") {
            output.error("Work needs attention or more time. Existing cloud sessions continue; inspect their status before resuming the same approved batch.");
            process.exitCode = 2;
          }
        } else output.data(await reconcile());
      }
    }
    return;
  }
  if (command === "publish" && values.pr !== undefined) {
    if (!values.proposal) throw new Error("Provide a PR description proposal with body, headSha and beforeHash.");
    output.data(await publishDescription(api(token()), config, Number(values.pr), await readJson(await safePath(root, values.proposal)), values.apply === true));
    if (!values.apply) output.text("Preview only. Confirm the handoff and actual checks before --apply.");
    return;
  }
  if (command === "status" && values.memory) {
    output.data(await memoryContext(root, config, values.memory, values.topic ?? []));
    return;
  }
  if (command === "status" && values["ado-id"]) {
    if (!config.ado) throw new Error("Configure ADO before importing work items.");
    output.data(await importWorkItem(adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? ""), config.ado, integer(Number(values["ado-id"]), "ADO ID")));
    return;
  }
  const github = api(token());
  if (command === "status" && values.pr) {
    const pr = record(await github.request("GET", `/repos/${config.repository}/pulls/${integer(Number(values.pr), "PR number")}`), "pull request");
    const usage = await collectPrUsage(github, config.repository, pr);
    output.data(usage, `${renderPrUsage(usage)}\n${usage.warnings.join("\n")}`);
  } else if (command === "status" && values.issue) {
    const number = integer(Number(values.issue), "issue number");
    const issue = record(await github.request("GET", `/repos/${config.repository}/issues/${number}`), "issue");
    output.data({
      uri: string(issue.html_url, "issue URL"), revision: string(issue.updated_at, "issue revision"),
      fingerprint: hash(`${string(issue.title, "issue title")}\n\n${typeof issue.body === "string" ? issue.body : ""}`),
      text: `${string(issue.title, "issue title")}\n\n${typeof issue.body === "string" ? issue.body : ""}`,
    });
  } else if (command === "status") {
    const work = await inspectWork(github, config);
    eligible(work, config.maxActive);
    output.data(work.map((item) => ({ issue: item.issue.number, task: item.metadata.task.id, state: item.state, reason: item.reason })));
  } else if (command === "internal-pr-check") {
    const number = integer(Number(values.pr), "PR number");
    const pr = record(await github.request("GET", `/repos/${config.repository}/pulls/${number}`), "PR");
    checkPrDescription(string(pr.body, "PR description"), limitsFor(config).pr);
    output.text("PR has concise what/why/checks sections. Human review still judges the reasoning and evidence.");
  } else if (command === "internal-dispatch") {
    const ado = config.ado ? adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "") : undefined;
    const hints = (process.env.CREWBIE_ISSUE_NUMBERS ?? "").trim();
    const issueNumbers = hints ? hints.split(",").map((value) => integer(Number(value), "confirmed issue number")) : [];
    if (issueNumbers.length > 100) throw new Error("At most 100 confirmed issue IDs can be reconciled at once.");
    const work = await dispatch(github, config, ado, issueNumbers.length ? { issueNumbers } : undefined);
    const summary = renderDispatchResult(work, config);
    output.text(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    if (config.ado) await syncAdo(github, adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? ""), config, work);
  } else if (command === "internal-maintain") {
    if (values.prepare === values.apply) throw new Error("Choose --prepare or --apply, not both.");
    output.text(values.prepare ? `Selected ${await prepareMaintenance(root, github, config)} new evidence records.` : await applyMaintenance(root, github, config));
  } else if (command === "internal-plan") {
    if (values.prepare === values.apply) throw new Error("Choose --prepare or --apply for planning.");
    if (values.prepare) {
      if (!process.env.GITHUB_EVENT_PATH || process.env.GITHUB_EVENT_NAME !== "issues") throw new Error("Planning preparation requires a GitHub issues event.");
      const result = await preparePlanning(root, github, config, await readJson(process.env.GITHUB_EVENT_PATH),
        process.env.GITHUB_RUN_ID ? integer(Number(process.env.GITHUB_RUN_ID), "workflow run ID") : undefined);
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${result.ready}\nmodel=${result.model}\n`);
      output.text(result.reason);
    } else output.text(await publishPlanning(root, github, config));
  } else if (command === "internal-release-plan") {
    if (!values.pr) throw new Error("Choose a merged planning PR with --pr.");
    const ado = config.ado ? adoApi(config.ado, process.env.CREWBIE_ADO_TOKEN ?? "") : undefined;
    output.text(await releaseMergedPlan(github, config, integer(Number(values.pr), "planning PR"), ado));
  } else if (command === "internal-pages") {
    if (!["private", "public"].includes(values["pages-mode"] ?? "")) throw new Error("Explicitly select private or public Pages mode.");
    const pages = record(await github.request("GET", `/repos/${config.repository}/pages`), "Pages configuration");
    if (values["pages-mode"] === "private" && pages.public !== false) throw new Error("Private Pages was not confirmed. Use the access-controlled Actions artifact instead.");
    if (values["pages-mode"] === "public" && pages.public !== true) throw new Error("Configured Pages visibility does not match the explicitly selected public mode.");
    output.text(`Pages visibility confirmed: ${values["pages-mode"]}.`);
  } else if (command === "dashboard" && values.collect) {
    if (!values.out) throw new Error("Choose a report path with --out.");
    await writeAtomic(root, values.out, dashboard(await collectRecords(github, config)));
    output.text(`Report written to ${values.out}.`);
  } else throw new Error(`Unknown command or missing input: ${command}. Use --help.`);
}

main().catch((error: unknown) => {
  createOutput({ machine: process.argv.includes("--json") || process.argv.some((arg) => arg.startsWith("internal-")) })
    .error(error instanceof Error ? error.message : "Unexpected failure.");
  process.exitCode = 1;
});
