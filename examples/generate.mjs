#!/usr/bin/env node
// Regenerates the Crewbie-owned files of the worked examples with Crewbie's own setup and planning code (`npm run examples`).
// Each scenario.mjs holds the repository before init, the Crewbie Compass answers, the review Copilot returned and
// the issues planned in the two months since. project/ is the repository today: the generator writes what Crewbie
// installs and plans; application code, memory, decisions and files the team changed on purpose are written by hand.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assess } from "../dist/setup/assessment.js";
import { parseSetupReview, selectGuidance } from "../dist/setup/onboarding.js";
import { DESTINATION_FILE, renderDestination } from "../dist/setup/interview.js";
import { installation } from "../dist/setup/install.js";
import { renderSetupMarkdown } from "../dist/setup/review.js";
import { readPlanningOutput } from "../dist/specification/planning-output.js";
import { planName, planningFiles } from "../dist/specification/planning.js";
import { textHash } from "../dist/core.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS = ["dotnet-modernisation", "foundry-hosted-agents", "java-21-upgrade"];
/** The account catalog the examples choose from; real init lists the models your Copilot account offers. */
export const MODELS = [
  { id: "claude-opus-5.5", name: "Claude Opus 5.5" }, { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }, { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" }, { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" },
];
/** Memory grows with every merged PR, so after init it belongs to the team, not the generator. */
export const MEMORY = /^\.crewbie\/(?:team|decisions)\//;

export async function scenario(name) {
  return (await import(pathToFileURL(join(here, name, "scenario.mjs")).href)).default;
}

/**
 * Renders one scenario. `output` maps example-relative paths to the content the generator owns; `deleted` lists
 * project paths init removed; `memory` holds the seeds init wrote, used only where the team has no memory file yet.
 */
export async function render(name) {
  const example = await scenario(name);
  const root = await mkdtemp(join(tmpdir(), "crewbie-example-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    for (const [path, content] of Object.entries(example.files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    const assessment = await assess(root);
    const destination = renderDestination(example.destination);
    const description = `${destination}\n(Setup creates ${DESTINATION_FILE} with exactly this map when the proposal is installed.)`;
    const proposal = parseSetupReview(JSON.stringify(example.review(assessment)), assessment, description, "claude-opus-5.5", MODELS);
    proposal.destination = destination;
    Object.assign(proposal.config, {
      repository: example.repository, local: { start: example.start },
      planning: { enabled: true, model: "claude-opus-5.5", executeOnMerge: true },
    });
    const changes = await installation(root, selectGuidance(proposal, true));
    const output = new Map([["setup/crewbie-setup.md", `${renderSetupMarkdown(proposal, changes)}\n## Installation choice\n\nTeam plus the concrete guidance edits listed above.\n`]]);
    const memory = new Map();
    const deleted = [];
    for (const change of changes) {
      if (change.after === null) deleted.push(change.path);
      else if (MEMORY.test(change.path)) memory.set(change.path, change.after);
      else if (!(change.path in example.evolved)) output.set(`project/${change.path}`, change.after);
    }
    const config = proposal.config;
    const configText = changes.find((change) => change.path === ".crewbie/config.json").after;
    for (const issue of example.issues) {
      for (const [path, content] of Object.entries(plan(issue, config, configText))) output.set(`project/${path}`, content);
    }
    return { output, deleted, memory, warnings: proposal.review.warnings ?? [], config, changes };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * The files the planning PR for an issue adds under `.crewbie/plans/<title-slug>-issue-<n>/`, as the planning workflow writes them.
 * The scenario supplies the coordinator's answer; task models come from the owning role, as the planning schema requires.
 * Plan checks run without a repository map, so they compare the plan with the issue only. The run-specific
 * execution.json is omitted.
 */
function plan(issue, config, configText) {
  const tasks = issue.plan.tasks.map((task) => ({ ...task, model: config.roles.find((role) => role.id === task.owner)?.model ?? "missing role" }));
  const source = { number: issue.number, title: issue.title, body: issue.body, revision: issue.updatedAt, labelEvent: 1 };
  const answer = JSON.stringify({ summary: issue.plan.summary, questions: [], batch: { schemaVersion: 1, id: `issue-${issue.number}`, approval: null, tasks } });
  const { plan: parsed } = readPlanningOutput(answer, config, source);
  return planningFiles(config, textHash(configText), source, parsed, `.crewbie/plans/${planName(issue.title, issue.number)}`, false, null).files;
}

async function exists(path) {
  return readFile(path).then(() => true, () => false);
}

async function write(name) {
  const { output, deleted, memory, warnings } = await render(name);
  if (warnings.length) throw new Error(`${name} has repository warnings:\n${warnings.join("\n")}`);
  const target = (path) => join(here, name, path);
  for (const [path, content] of [...output, ...[...memory].map(([path, content]) => [`project/${path}`, content])]) {
    if (MEMORY.test(path.slice("project/".length)) && await exists(target(path))) continue;
    await mkdir(dirname(target(path)), { recursive: true });
    await writeFile(target(path), content);
  }
  for (const path of deleted) await rm(target(`project/${path}`), { force: true });
  console.log(`${name}: ${output.size} generated files`);
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
