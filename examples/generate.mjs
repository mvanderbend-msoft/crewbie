#!/usr/bin/env node
// Regenerates the worked examples from their scenario.mjs files with Crewbie's own setup code (run `npm run examples`).
// Each scenario is a stub repository, the Compass map and the review Copilot returned; the output is what
// `crewbie init` would install when the human chooses "All".
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assess } from "../dist/setup/assessment.js";
import { parseSetupReview, selectGuidance } from "../dist/setup/onboarding.js";
import { DESTINATION_FILE, renderDestination } from "../dist/setup/interview.js";
import { installation } from "../dist/setup/install.js";
import { renderSetupMarkdown } from "../dist/setup/review.js";
import { readPlanningOutput } from "../dist/specification/planning-output.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS = ["dotnet-modernisation", "foundry-hosted-agents", "java-21-upgrade"];
/** The account catalog the examples choose from; real init lists the models your Copilot account offers. */
export const MODELS = [
  { id: "claude-opus-5.5", name: "Claude Opus 5.5" }, { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }, { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" }, { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" },
];
/** Files every installation gets unchanged; the examples show only what Copilot tailored to the repository. */
const STANDARD = /^(?:\.github\/workflows\/crewbie-|\.github\/skills\/crewbie\/|\.github\/PULL_REQUEST_TEMPLATE\.md$|\.github\/agents\/crewbie-(?:coordinator|improver)\.agent\.md$|\.crewbie\/(?:instructions\.md|team\/|decisions\/))/;

/** Renders one scenario: `crewbie-setup.md` plus the tailored files under `repo/`, keyed by example-relative path. */
export async function render(name) {
  const scenario = (await import(pathToFileURL(join(here, name, "scenario.mjs")).href)).default;
  const root = await mkdtemp(join(tmpdir(), "crewbie-example-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    for (const [path, content] of Object.entries(scenario.files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    const assessment = await assess(root);
    const destination = renderDestination(scenario.destination);
    const description = `${destination}\n(Setup creates ${DESTINATION_FILE} with exactly this map when the proposal is installed.)`;
    const proposal = parseSetupReview(JSON.stringify(scenario.review(assessment)), assessment, description, "claude-opus-5.5", MODELS);
    proposal.destination = destination;
    Object.assign(proposal.config, {
      repository: scenario.repository, local: { start: scenario.start },
      planning: { enabled: true, model: "claude-opus-5.5", executeOnMerge: true },
    });
    const changes = await installation(root, selectGuidance(proposal, true));
    const output = new Map([["crewbie-setup.md", `${renderSetupMarkdown(proposal, changes)}\n## Installation choice\n\nTeam plus the concrete guidance edits listed above.\n`]]);
    for (const change of changes) if (change.after !== null && !STANDARD.test(change.path)) output.set(`repo/${change.path}`, change.after);
    if (scenario.issue) {
      output.set("issue.md", `# ${scenario.issue.title}\n\n${scenario.issue.body}`);
      output.set("plan.json", `${JSON.stringify(plan(scenario, proposal.config), null, 2)}\n`);
    }
    return { output, warnings: proposal.review.warnings ?? [], config: proposal.config, changes };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * The batch the planning PR commits for the sample issue (`.crewbie/plans/issue-<n>/batch.json`); merging that PR approves it.
 * The scenario supplies the coordinator's answer; task models come from the owning role, as the planning schema requires.
 */
function plan(scenario, config) {
  const { issue } = scenario;
  const tasks = scenario.plan.tasks.map((task) => ({ ...task, model: config.roles.find((role) => role.id === task.owner)?.model ?? "missing role" }));
  const source = { number: issue.number, title: issue.title, body: issue.body, revision: issue.updatedAt, labelEvent: 1 };
  const output = JSON.stringify({ summary: scenario.plan.summary, questions: [], batch: { schemaVersion: 1, id: `issue-${issue.number}`, approval: null, tasks } });
  const { plan: { batch } } = readPlanningOutput(output, config, source);
  return batch;
}

async function write(name) {
  const { output, warnings } = await render(name);
  if (warnings.length) throw new Error(`${name} has repository warnings:\n${warnings.join("\n")}`);
  await rm(join(here, name, "repo"), { recursive: true, force: true });
  for (const [path, content] of output) {
    await mkdir(dirname(join(here, name, path)), { recursive: true });
    await writeFile(join(here, name, path), content);
  }
  console.log(`${name}: ${output.size} files`);
}

/** Every file under a directory, relative and with forward slashes. */
export async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), `${path}/`));
    else files.push(path);
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : SCENARIOS) await write(name);
}
