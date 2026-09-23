import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { assess } from "../dist/setup/assessment.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { workflows, profile, SHARED_INSTRUCTIONS, SKILL } from "../dist/setup/templates.js";
import { bounded, hash, safePath } from "../dist/core.js";
import { parseConfig } from "../dist/config.js";
import { fixture, config } from "./helpers.mjs";

test("brownfield assessment reuses guidance, reports unverified builds, and executes no scripts", async (t) => {
  const root = await fixture(t, {
    "package.json": JSON.stringify({ scripts: { test: "MUST-NOT-EXECUTE" } }),
    "AGENTS.md": "Preserve existing API behavior.",
    ".specify/memory/constitution.md": "Existing approved principles.",
    "src/Button.tsx": "export const Button = 1;",
    "test/api.test.ts": "test",
  });
  const report = await assess(root);
  assert.equal(report.config.constitution, ".specify/memory/constitution.md");
  assert.equal(report.findings.find((f) => f.area === "Build and tests").status, "unknown");
  assert.ok(report.config.roles.some((role) => role.id === "frontend"));
  assert.equal(report.constitutionText, null);
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "Preserve existing API behavior.");
});

test("initial assessment does not change a repository", async (t) => {
  const root = await fixture(t, { "README.md": "A project." });
  await assess(root);
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});

test("full-stack assessment includes nested source evidence and keeps planning context out of requirement sources", async (t) => {
  const root = await fixture(t, { "frontend/src/App.tsx": "export const App = 1;", "backend/src/main/java/App.java": "class App {}" });
  const report = await assess(root);
  assert.deepEqual(report.config.roles.map((role) => role.id), ["frontend", "backend", "tester", "reviewer"]);
  assert.deepEqual(report.findings.find((finding) => finding.area === "Code structure").evidence,
    ["backend/src/main/java/App.java", "frontend/src/App.tsx"]);
  assert.match(profile({ id: "coordinator", purpose: "Coordinate.", model: "" }, config()), /requirement inputs only/);
  assert.match(SKILL, /ownership-manifest hashes are not\s+read revisions/);
});

test("assessment proposes a small specialist team and installs dormant learning memory", async (t) => {
  const root = await fixture(t, { "src/helpers.js": "export const answer = 42;" });
  const proposal = await assess(root);
  assert.deepEqual(proposal.config.roles.map((role) => role.id), ["developer", "tester", "reviewer"]);
  assert.ok(proposal.config.roles.every((role) => role.model === ""), "Model choices still need approval.");
  const changes = await installation(root, proposal);
  for (const role of ["developer", "tester", "reviewer", "coordinator", "improver"]) {
    assert.ok(changes.some((change) => change.path === `.github/agents/crewbie-${role}.agent.md`), role);
    assert.ok(changes.some((change) => change.path === `.crewbie/team/${role}/hot.md`), role);
    assert.ok(changes.some((change) => change.path === `.crewbie/team/${role}/index.md`), role);
  }
  assert.equal(proposal.config.nightly.enabled, false, "Provisioning a role must not authorize paid execution.");
});

test("specialists have distinct duties and an actionable scoped memory handoff", () => {
  for (const role of ["developer", "tester", "reviewer", "coordinator", "improver"]) {
    const text = profile({ id: role, purpose: `${role} purpose.`, model: "" }, config());
    bounded(text, 400, role);
    assert.match(text, /\.crewbie\/instructions\.md/);
    assert.match(text, new RegExp(`Identify yourself as .crewbie-${role}`));
  }
  assert.match(SHARED_INSTRUCTIONS, /approved scope/i);
  assert.match(SHARED_INSTRUCTIONS, /work branch/);
  assert.match(SHARED_INSTRUCTIONS, /crewbie-memory-proposal/);
  assert.match(SHARED_INSTRUCTIONS, /no new durable lesson/i);
  assert.match(profile({ id: "tester", purpose: "Test.", model: "" }, config()), /boundary|edge/i);
  assert.match(profile({ id: "reviewer", purpose: "Review.", model: "" }, config()), /findings.*evidence/i);
});

test("domain charters contain distinct checks, invariants and reviewed repository guidance", () => {
  const frontend = profile({ id: "frontend", purpose: "User interface.", model: "approved-model", checks: ["npm run build"], nonNegotiables: ["Preserve unsaved product edits."] }, config());
  const backend = profile({ id: "backend", purpose: "Services.", model: "approved-model" }, config());
  bounded(frontend, 400, "frontend");
  bounded(backend, 400, "backend");
  assert.doesNotMatch(frontend, /observers.*automatic request loop/);
  assert.match(frontend, /npm run build/);
  assert.match(frontend, /Preserve unsaved product edits/);
  assert.match(backend, /transactional rollback/);
  assert.match(backend, /database-bounded/);
  assert.doesNotMatch(backend, /keyboard/);
  assert.doesNotMatch(frontend, /transactional rollback/);
  const configured = parseConfig(config({ roles: [{ id: "frontend", purpose: "UI.", model: "approved-model", checks: ["npm test"], nonNegotiables: ["Use established tokens."] }] }));
  assert.deepEqual(configured.roles[0].checks, ["npm test"]);
  assert.deepEqual(configured.roles[0].nonNegotiables, ["Use established tokens."]);
  const custom = profile({ id: "constructor", purpose: "Review object construction.", model: "approved-model", checks: ["Check initialization invariants."] }, config());
  assert.doesNotMatch(custom, /Trace the changed behavior/);
  assert.match(custom, /Check initialization invariants/);
  assert.doesNotMatch(custom, /function Object/);
});

test("hosted maintenance separates read-only preparation, tool-free AI and write-capable publication", () => {
  const workflow = YAML.parse(workflows(true)[".github/workflows/crewbie-maintain.yml"]);
  assert.equal(workflow.jobs.prepare.permissions.contents, "read");
  assert.equal(workflow.jobs.analyze.permissions["copilot-requests"], "write");
  assert.notEqual(workflow.jobs.analyze.permissions.contents, "write");
  assert.equal(workflow.jobs.publish.permissions.contents, "write");
  assert.equal(workflow.jobs.publish.permissions["pull-requests"], "write");
  assert.deepEqual(workflow.jobs.publish.needs, ["prepare", "analyze"]);
  assert.equal(Object.values(workflow.jobs).reduce((sum, job) => sum + job["timeout-minutes"], 0), 15);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.CREWBIE_(USER|COPILOT)_TOKEN/);
  const analysis = workflow.jobs.analyze.steps.find((step) => step.name === "Run bounded maintenance analysis");
  assert.equal(analysis.env.GITHUB_TOKEN, "${{ github.token }}");
  assert.match(analysis.run, /--deny-tool shell write url/);
  assert.doesNotMatch(analysis.run, /--deny-tool '\*'/);
});

test("installer previews, applies idempotently, and preserves edits on upgrade", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Human-owned guidance." });
  const proposal = { config: config(), constitutionText: null };
  const changes = await installation(root, proposal);
  assert.ok(changes.some((change) => change.path === ".github/agents/crewbie-developer.agent.md"));
  assert.ok(!changes.some((change) => change.path === "AGENTS.md"));
  await applyInstallation(root, changes);
  assert.deepEqual(await installation(root, proposal), []);
  const agent = join(root, ".github/agents/crewbie-developer.agent.md");
  await writeFile(agent, "Human change.");
  await assert.rejects(installation(root, proposal), /Preserving user-owned or edited/);
  assert.equal(await readFile(agent, "utf8"), "Human change.");
});

test("installer detects changes made after preview", async (t) => {
  const root = await fixture(t);
  const changes = await installation(root, { config: config(), constitutionText: null });
  await mkdir(join(root, ".crewbie"));
  await writeFile(join(root, ".crewbie/config.json"), "{}");
  await assert.rejects(applyInstallation(root, changes), /changed since preview/);
});

test("constitution requires explicit text and an approved path; legacy files are not replaced", async (t) => {
  const root = await fixture(t, { "constitution.md": "Existing contract." });
  const reused = { config: config({ constitution: "constitution.md" }), constitutionText: null };
  const changes = await installation(root, reused);
  assert.ok(!changes.some((change) => change.path === "constitution.md"));
  await assert.rejects(installation(root, { ...reused, constitutionText: "New rules." }), /Preserving user-owned/);
  await assert.rejects(installation(root, { config: config(), constitutionText: "New" }), /Select a constitution path/);
});

test("word budgets enforce exact boundary without truncation", () => {
  bounded("word ".repeat(600), 600, "spec");
  assert.throws(() => bounded("word ".repeat(601), 600, "spec"), /nothing was truncated/);
});

test("managed paths reject traversal, Git internals and symlink parents", async (t) => {
  const root = await fixture(t);
  await assert.rejects(safePath(root, "../outside"), /leaves repository/);
  await assert.rejects(safePath(root, ".git/config"), /Git internals/);
  await mkdir(join(root, "target"));
  await symlink(join(root, "target"), join(root, "linked"), "junction");
  await assert.rejects(safePath(root, "linked/file.md"), /Symlinks/);
});

test("configuration rejects duplicate roles, path escalation, and empty runtime assumptions", () => {
  assert.throws(() => parseConfig(config({ roles: [config().roles[0], config().roles[0]] })), /unique/);
  assert.throws(() => parseConfig(config({ nightly: { enabled: true, maxRecords: 20, allowedPaths: [".github/workflows/"] } })), /not a supported/);
  assert.throws(() => parseConfig(config({ constitution: ".env" })), /Markdown/);
});

test("generated workflows parse and never execute PR-head code", () => {
  const files = workflows();
  for (const content of Object.values(files)) assert.ok(YAML.parse(content).jobs);
  const dispatcher = YAML.parse(files[".github/workflows/crewbie-dispatch.yml"]);
  assert.equal(dispatcher.concurrency["cancel-in-progress"], false);
  assert.equal(dispatcher.jobs.dispatch.steps[0].with.ref, "${{ github.event.repository.default_branch }}");
  const maintenance = files[".github/workflows/crewbie-maintain.yml"];
  assert.match(maintenance, /--no-custom-instructions --disable-builtin-mcps --available-tools --silent/);
  assert.doesNotMatch(maintenance, /--allow-all/);
  const report = YAML.parse(files[".github/workflows/crewbie-report.yml"]);
  assert.match(report.jobs.pages.if, /CREWBIE_PAGES_MODE/);
  assert.equal(report.jobs.report.permissions.issues, "read");
  assert.equal(report.jobs.report.permissions["pull-requests"], "read");
  assert.equal(report.jobs.report.permissions.checks, "read");
  assert.equal(report.jobs.report.steps.find((step) => step.name === "Build usage report").env.GH_TOKEN, "${{ github.token }}");
});

test("ready-label workflow has an exact package fallback when CREWBIE_PACKAGE is unset", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = YAML.parse(workflows(false, true)[".github/workflows/crewbie-plan.yml"]);
  const installs = Object.values(workflow.jobs).flatMap((job) => job.steps)
    .filter((step) => step.name === "Install approved Crewbie package");
  assert.ok(installs.length);
  for (const step of installs) {
    assert.equal(step.env.CREWBIE_PACKAGE, `\${{ vars.CREWBIE_PACKAGE || 'https://github.com/mvanderbend-msoft/crewbie/releases/download/v${manifest.version}/crewbie-cli-${manifest.version}.tgz' }}`);
    assert.doesNotMatch(step.run, /Set CREWBIE_PACKAGE to an approved pinned package/);
  }
});

test("GitHub releases publish npm-installable artifacts while registry publishing is opt-in", async () => {
  const workflow = YAML.parse(await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"));
  assert.equal(workflow.jobs.artifacts.permissions.contents, "write");
  assert.ok(workflow.jobs.artifacts.steps.some((step) => /gh release upload/.test(step.run ?? "")));
  assert.match(workflow.jobs.publish.if, /CREWBIE_NPM_PUBLISH_ENABLED == 'true'/);
  assert.equal(workflow.jobs.publish.needs, "artifacts");
  assert.equal(workflow.jobs.publish.permissions["id-token"], "write");
});

test("every generated role has concise writing and explicit memory pointers", () => {
  const text = profile(config().roles[0], config());
  bounded(text, 400, "charter");
  assert.match(text, /hot\.md/);
  assert.match(text, /index\.md/);
  for (const heading of ["What changed", "Why", "Checks"]) assert.ok(text.includes(`\`## ${heading}\``));
  assert.equal(hash(text), hash(profile(config().roles[0], config())));
});

test("nightly cron is opt-in, while manual maintenance remains available", () => {
  assert.equal(YAML.parse(workflows()[".github/workflows/crewbie-maintain.yml"]).on.schedule, undefined);
  assert.equal(YAML.parse(workflows(true)[".github/workflows/crewbie-maintain.yml"]).on.schedule.length, 1);
});

test("explicit hash-bound adoption can update an existing instruction file", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Existing constraints." });
  const proposal = { config: config(), constitutionText: null, instructions: [{
    path: "AGENTS.md", beforeHash: hash("Existing constraints."), content: "Existing constraints.\nRead the approved Crewbie constitution and relevant role memory.",
  }] };
  await applyInstallation(root, await installation(root, proposal));
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /Existing constraints/);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /approved Crewbie/);
});

test("Git-style CRLF checkouts do not look like edits to managed text", async (t) => {
  const root = await fixture(t);
  const proposal = { config: config(), constitutionText: null };
  const changes = await installation(root, proposal);
  await applyInstallation(root, changes);
  for (const change of changes) {
    await writeFile(join(root, change.path), change.after.replaceAll("\n", "\r\n"));
  }
  assert.deepEqual(await installation(root, proposal), []);
  const upgrade = await installation(root, { ...proposal, config: config({ maxActive: 1 }) });
  assert.ok(upgrade.some((change) => change.path === ".crewbie/config.json"));
  await applyInstallation(root, upgrade);
  const agent = join(root, ".github/agents/crewbie-developer.agent.md");
  await writeFile(agent, (await readFile(agent, "utf8")) + "A real edit.\r\n");
  await assert.rejects(installation(root, proposal), /Preserving user-owned or edited/);
});

test("new installations provide the required PR structure without replacing an existing template", async (t) => {
  const root = await fixture(t);
  const proposal = { config: config(), constitutionText: null };
  const changes = await installation(root, proposal);
  const template = changes.find((change) => change.path === ".github/PULL_REQUEST_TEMPLATE.md");
  assert.ok(template, "The cloud summary generator needs a repository PR template, not only agent prose.");
  assert.match(template.after, /## What changed/);
  assert.match(template.after, /## Why/);
  assert.match(template.after, /## Checks/);
  for (const path of [".github/PULL_REQUEST_TEMPLATE.md", "docs/pull_request_template.md", "PULL_REQUEST_TEMPLATE.md", ".github/PULL_REQUEST_TEMPLATE/bug.md"]) {
    const existing = await fixture(t, { [path]: "Existing team template." });
    assert.ok(!(await installation(existing, proposal)).some((change) => change.path === ".github/PULL_REQUEST_TEMPLATE.md"));
  }
});
