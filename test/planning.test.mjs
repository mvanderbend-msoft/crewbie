import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { parseConfig, PLANNING_LABEL } from "../dist/config.js";
import { GitHubError, hash } from "../dist/core.js";
import { preparePlanning, publishPlanning, parsePlan } from "../dist/specification/planning.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { workflows } from "../dist/setup/templates.js";
import { fixture, config, task } from "./helpers.mjs";

async function planningFixture(t) {
  const cfg = parseConfig(config({ planning: { enabled: true, model: "planning-model" } }));
  const root = await fixture(t, { "package.json": '{"dependencies":{"react":"1"}}', "AGENTS.md": "Preserve posted ledger balances." });
  await applyInstallation(root, await installation(root, { config: cfg, constitutionText: null }));
  execFileSync("git", ["-C", root, "add", "."], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture"]);
  const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const source = { number: 12, title: "Progressive catalogue loading", body: "Load catalogue items incrementally and retain cards when later requests fail.", state: "open", updated_at: "2026-09-22T10:00:00Z", labels: [{ name: PLANNING_LABEL }] };
  const sender = { login: "maintainer", type: "User" };
  const event = { action: "labeled", label: { name: PLANNING_LABEL }, repository: { full_name: cfg.repository }, sender, issue: structuredClone(source) };
  const state = { source, sha, events: [{ id: 77, event: "labeled", label: { name: PLANNING_LABEL }, actor: sender }], pulls: [], branch: false, writes: [], tree: null, createPullFailure: false };
  const prefix = "/repos/example/project";
  const client = {
    async list(path) {
      if (path === `${prefix}/issues/12/events`) return state.events;
      if (path.startsWith(`${prefix}/pulls?state=all&head=example:crewbie/plans/issue-12-`)) return state.pulls;
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      if (method !== "GET") state.writes.push({ method, path, body });
      if (method === "GET" && path === `${prefix}/issues/12`) return state.source;
      if (method === "GET" && path === prefix) return { default_branch: "main" };
      if (method === "GET" && path === `${prefix}/git/ref/heads/main`) return { object: { sha: state.sha } };
      if (method === "GET" && path.startsWith(`${prefix}/git/ref/heads/crewbie/plans/`)) {
        if (state.branch) return { object: { sha: "planning-commit" } };
        throw new GitHubError(404, null);
      }
      if (method === "GET" && path === `${prefix}/git/commits/${sha}`) return { tree: { sha: "base-tree" } };
      if (method === "POST" && path === `${prefix}/git/trees`) { state.tree = body.tree; return { sha: "planning-tree" }; }
      if (method === "POST" && path === `${prefix}/git/commits`) return { sha: "planning-commit" };
      if (method === "POST" && path === `${prefix}/git/refs`) { state.branch = true; return {}; }
      if (method === "POST" && path === `${prefix}/pulls`) {
        if (state.createPullFailure) throw new Error("Unknown PR publication outcome.");
        const pull = { html_url: "https://github.com/example/project/pull/13", body: body.body, head: { ref: body.head, repo: { full_name: cfg.repository } } };
        state.pulls = [pull];
        return pull;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  const candidate = {
    summary: "Propose catalogue paging with bounded requests and explicit retry.",
    questions: [], roles: cfg.roles,
    batch: { schemaVersion: 1, id: "model-id", spec: "Load a page at a time. Preserve cards and require explicit retry after failure.", tasks: [task("paging")], approval: null },
  };
  const output = (value = candidate) => writeFile(join(root, ".crewbie-planning-output.txt"), JSON.stringify(value));
  return { cfg, root, event, state, client, candidate, output };
}

test("ready label loads the actual coordinator charter/history and proposes owners without authorizing execution", async (t) => {
  const f = await planningFixture(t);
  const prepared = await preparePlanning(f.root, f.client, f.cfg, f.event);
  assert.equal(prepared.ready, true);
  assert.equal(prepared.model, "planning-model");
  const prompt = await readFile(join(f.root, ".crewbie-planning-prompt.txt"), "utf8");
  assert.match(prompt, /name: crewbie-coordinator/);
  assert.match(prompt, /coordinator\/hot\.md/);
  assert.match(prompt, /Preserve posted ledger balances/);
  assert.match(prompt, /not a fixed roster/);
  assert.match(prompt, /Attachments|attachments have NOT been fetched/);
  assert.match(prompt, /frontend/);
  assert.equal(f.state.writes.length, 0, "Preparation has no remote write capability.");
  await f.output();
  assert.match(await publishPlanning(f.root, f.client, f.cfg), /pull\/13/);
  assert.deepEqual(f.state.tree.map((entry) => entry.path), [".crewbie/plans/issue-12/setup.json", ".crewbie/plans/issue-12/plan.md", ".crewbie/plans/issue-12/batch.json"]);
  const batch = JSON.parse(f.state.tree.find((entry) => entry.path.endsWith("batch.json")).content);
  assert.equal(batch.approval, null);
  assert.equal(batch.tasks[0].owner, "developer");
  assert.deepEqual(batch.sources, [{ uri: "https://github.com/example/project/issues/12", revision: f.state.source.updated_at, fingerprint: hash(`${f.state.source.title}\n\n${f.state.source.body}`) }]);
  assert.equal(f.state.writes.at(-1).body.draft, true);
  assert.match(f.state.writes.at(-1).body.body, /crewbie-coordinator/);
  assert.ok(f.state.writes.every((write) => !write.path.includes("/assignees") && !write.path.endsWith("/issues")));
  assert.match(f.state.writes.find((write) => write.path.endsWith("/git/commits")).body.message, /Co-authored-by: Copilot/);
});

test("disabled intake, wrong labels, outsiders and generated execution issues never prepare paid analysis", async (t) => {
  const f = await planningFixture(t);
  for (const [cfg, event] of [
    [{ ...f.cfg, planning: { enabled: false, model: "" } }, f.event],
    [f.cfg, { ...f.event, label: { name: "crewbie:ready" } }],
    [f.cfg, { ...f.event, sender: { login: "outsider", type: "User" } }],
    [f.cfg, { ...f.event, sender: { login: "maintainer", type: "Bot" } }],
    [f.cfg, { ...f.event, issue: { ...f.event.issue, body: "<!-- crewbie-task:generated -->" } }],
  ]) {
    assert.equal((await preparePlanning(f.root, f.client, cfg, event)).ready, false);
    await assert.rejects(readFile(join(f.root, ".crewbie-planning-input.json")), /ENOENT/);
  }
  assert.equal(f.state.writes.length, 0);
});

test("label provenance, source edits and repository identity are checked before analysis", async (t) => {
  const f = await planningFixture(t);
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, { ...f.event, repository: { full_name: "other/project" } }), /another repository/);
  f.state.events[0].actor = { login: "outsider", type: "User" };
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /configured human approver/);
  f.state.events[0].actor = f.event.sender;
  f.state.source.body += " New scope.";
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /changed after the ready label/);
  assert.equal(f.state.writes.length, 0);
});

test("publication stops if source, label, policy or default branch changes during analysis", async (t) => {
  const f = await planningFixture(t);
  await preparePlanning(f.root, f.client, f.cfg, f.event);
  await f.output();
  f.state.source.body += " Changed.";
  await assert.rejects(publishPlanning(f.root, f.client, f.cfg), /Source or label approval changed/);
  f.state.source.body = f.event.issue.body;
  f.state.events[0].id++;
  await assert.rejects(publishPlanning(f.root, f.client, f.cfg), /Source or label approval changed/);
  f.state.events[0].id--;
  await assert.rejects(publishPlanning(f.root, f.client, { ...f.cfg, maxActive: 1 }), /configuration changed/);
  f.state.sha = "new-main";
  await assert.rejects(publishPlanning(f.root, f.client, f.cfg), /Default branch changed/);
  assert.equal(f.state.writes.length, 0);
});

test("existing plans are skipped and uncertain branch publication is never overwritten or blindly retried", async (t) => {
  const f = await planningFixture(t);
  await preparePlanning(f.root, f.client, f.cfg, f.event);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  const writes = f.state.writes.length;
  assert.match(await publishPlanning(f.root, f.client, f.cfg), /already exists/);
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, f.event)).ready, false);
  assert.equal(f.state.writes.length, writes);
  f.state.pulls = [];
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /interrupted publication/);
  assert.equal(f.state.writes.length, writes);
});

test("model output supports custom expertise and clarification, but cannot self-approve or bypass role/domain validation", async (t) => {
  const f = await planningFixture(t);
  const source = { ...f.state.source, revision: f.state.source.updated_at, labelEvent: 77 };
  const role = { id: "catalogue-performance", purpose: "Own catalogue query performance.", model: "proposed-model", checks: ["Measure bounded query work."], nonNegotiables: ["Preserve stable paging contracts."] };
  const custom = { ...f.candidate, roles: [role], batch: { ...f.candidate.batch, tasks: [{ ...task("query"), owner: role.id, model: role.model }] } };
  assert.equal(parsePlan(custom, f.cfg, source).batch.tasks[0].owner, role.id);
  assert.equal(parsePlan({ ...custom, batch: null, questions: ["Which catalogue sort order is required?"] }, f.cfg, source).batch, null);
  assert.throws(() => parsePlan({ ...custom, batch: null }, f.cfg, source), /clarification/);
  assert.throws(() => parsePlan({ ...custom, batch: { ...custom.batch, approval: { digest: "fake", execute: true } } }, f.cfg, source), /cannot approve/);
  assert.throws(() => parsePlan({ ...custom, roles: [{ ...role, checks: [] }] }, f.cfg, source), /domain checks/);
  assert.throws(() => parsePlan({ ...custom, batch: { ...custom.batch, tasks: [task("wrong-owner")] } }, f.cfg, source), /owner\/model/);
  assert.throws(() => parsePlan({ ...custom, summary: "word ".repeat(101) }, f.cfg, source), /100 words/);
  assert.throws(() => parsePlan({ ...custom, summary: "-----BEGIN PRIVATE KEY-----" }, f.cfg, source), /secret/);
});

test("malformed or oversized analysis output cannot write a planning branch", async (t) => {
  const f = await planningFixture(t);
  await preparePlanning(f.root, f.client, f.cfg, f.event);
  await writeFile(join(f.root, ".crewbie-planning-output.txt"), "Not JSON");
  await assert.rejects(publishPlanning(f.root, f.client, f.cfg), /JSON/);
  await writeFile(join(f.root, ".crewbie-planning-output.txt"), "x".repeat(100001));
  await assert.rejects(publishPlanning(f.root, f.client, f.cfg), /100 KB/);
  assert.equal(f.state.writes.length, 0);
});

test("planning workflow is opt-in, label-gated and separates analysis from repository writes", () => {
  assert.equal(YAML.parse(workflows(false, false)[".github/workflows/crewbie-plan.yml"]).on.issues, undefined);
  const file = workflows(false, true)[".github/workflows/crewbie-plan.yml"];
  const flow = YAML.parse(file);
  assert.deepEqual(flow.on.issues.types, ["labeled"]);
  assert.match(flow.jobs.prepare.if, /crewbie:ready-for-planning/);
  assert.equal(flow.jobs.prepare.permissions.contents, "read");
  assert.deepEqual(flow.jobs.analyze.permissions, { "copilot-requests": "write" });
  assert.equal(flow.jobs.publish.permissions.contents, "write");
  assert.equal(flow.jobs.publish.permissions.issues, "read");
  assert.equal(flow.jobs.publish.permissions["pull-requests"], "write");
  assert.equal(Object.values(flow.jobs).reduce((sum, job) => sum + job["timeout-minutes"], 0), 15);
  assert.match(file, /--no-custom-instructions --disable-builtin-mcps --available-tools --silent --deny-tool shell write url/);
  assert.doesNotMatch(file, /secrets\.|pull_request\.head|github\.event\.issue\.body|--allow-all/);
  for (const model of ["auto", "model\nready=true", "", "model;echo bad"]) {
    assert.throws(() => parseConfig(config({ planning: { enabled: true, model } })));
  }
});

test("closed, unlabeled and oversized source issues cannot start paid planning", async (t) => {
  const f = await planningFixture(t);
  f.state.source.state = "closed";
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /open issue/);
  f.state.source.state = "open";
  f.state.source.labels = [];
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /requires the/);
  f.state.source.labels = [{ name: PLANNING_LABEL }];
  f.state.source.body = "x".repeat(50001);
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /50 KB/);
  f.state.source.body = "\u00e9".repeat(25001);
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /50 KB/);
  assert.equal(f.state.writes.length, 0);
});

test("description budgets are checked before remote writes and replacing roles cannot bypass the growth cap", async (t) => {
  const f = await planningFixture(t);
  const cfg = { ...f.cfg, limits: { ...f.cfg.limits, pr: 30 } };
  await preparePlanning(f.root, f.client, cfg, f.event);
  await f.output();
  await assert.rejects(publishPlanning(f.root, f.client, cfg), /30 words/);
  assert.equal(f.state.writes.length, 0);
  const role = { purpose: "Specific subsystem.", model: "model", checks: ["Check the contract."], nonNegotiables: ["Preserve data."] };
  const roles = Array.from({ length: 5 }, (_, i) => ({ ...role, id: `specialist-${i}` }));
  assert.throws(() => parsePlan({ ...f.candidate, roles }, config({ roles: Array.from({ length: 8 }, (_, i) => ({ ...role, id: `old-${i}` })) }), f.state.source), /four additional roles/);
});
