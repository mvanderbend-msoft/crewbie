import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { parseConfig, PLANNING_LABEL } from "../dist/config.js";
import { GitHubError, hash } from "../dist/core.js";
import { preparePlanning, publishPlanning, parsePlan, requestPlanningRevision } from "../dist/specification/planning.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { workflows } from "../dist/setup/templates.js";
import { approvedMergedPlan, releaseMergedPlan, planningLocation } from "../dist/execution/planning-approval.js";
import { fixture, config, task } from "./helpers.mjs";
const planned = (id, dependsOn = []) => ({ ...task(id, dependsOn), confidence: 0.9, confidenceReason: "Small, well-specified change." });

async function planningFixture(t, automatic = false) {
  const cfg = parseConfig(config({ planning: { enabled: true, model: "planning-model", executeOnMerge: automatic } }));
  const root = await fixture(t, { "package.json": '{"dependencies":{"react":"1"}}', "AGENTS.md": "Preserve posted ledger balances." });
  await applyInstallation(root, await installation(root, { config: cfg, constitutionText: null }));
  execFileSync("git", ["-C", root, "add", "."], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture"]);
  const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const source = { number: 12, title: "Progressive catalogue loading", body: "Load catalogue items incrementally and retain cards when later requests fail.", state: "open", updated_at: "2026-09-22T10:00:00Z", labels: [{ name: PLANNING_LABEL }] };
  const sender = { login: "maintainer", type: "User" };
  const event = { action: "labeled", label: { name: PLANNING_LABEL }, repository: { full_name: cfg.repository }, sender, issue: structuredClone(source) };
  const state = { source, sha, events: [{ id: 77, event: "labeled", label: { name: PLANNING_LABEL }, actor: sender }], pulls: [], branch: false, writes: [], tree: null, createPullFailure: false,
    run: { event: "issues", path: ".github/workflows/crewbie-plan.yml", head_sha: sha, head_branch: "main", head_repository: { full_name: cfg.repository }, actor: sender, status: "completed", conclusion: "success" },
    snapshots: new Map(), reviews: [], diff: [], executionIssues: [], comments: new Map(), labels: [], lock: false, dispatches: 0 };
  const baseFiles = { ".crewbie/config.json": await readFile(join(root, ".crewbie/config.json"), "utf8") };
  state.snapshots.set(sha, baseFiles);
  const blob = (content) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
  const prefix = "/repos/example/project";
  const client = {
    async list(path) {
      if (path === `${prefix}/issues/12/events`) return state.events;
      if (path.startsWith(`${prefix}/pulls?state=all&head=example:crewbie/plans/`)) return state.pulls;
      if (path === `${prefix}/pulls/13/reviews`) return state.reviews;
      if (path === `${prefix}/pulls/13/files`) return state.diff;
      if (path === `${prefix}/labels`) return state.labels;
      if (path === `${prefix}/issues?state=all&labels=crewbie%3Amanaged`) return state.executionIssues;
      const comments = /^\/repos\/example\/project\/issues\/(\d+)\/comments$/.exec(path);
      if (comments) return state.comments.get(Number(comments[1])) ?? [];
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      if (method !== "GET") state.writes.push({ method, path, body });
      if (method === "GET" && path === "/user") return sender;
      if (method === "GET" && path === `${prefix}/issues/12`) return state.source;
      if (method === "GET" && /^\/repos\/example\/project\/actions\/runs\/(?:42|43|44)$/.test(path)) return state.run;
      if (method === "GET" && path === `${prefix}/pulls/13`) return state.pulls[0];
      if (method === "GET" && path === `${prefix}/branches/main`) return { commit: { sha: state.sha } };
      if (method === "GET" && path.startsWith(`${prefix}/compare/`)) return { status: "identical", merge_base_commit: { sha: state.mergeBase ?? (state.pulls[0]?.state === "open" ? sha : "c".repeat(40)) } };
      const file = /^\/repos\/example\/project\/contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(path);
      if (method === "GET" && file) {
        const content = state.snapshots.get(file[2])?.[file[1]];
        if (content === undefined) throw new GitHubError(404, null);
        return { type: "file", encoding: "base64", content: Buffer.from(content).toString("base64"), size: Buffer.byteLength(content), sha: blob(content) };
      }
      if (method === "GET" && path === prefix) return { default_branch: "main" };
      if (method === "GET" && path === `${prefix}/git/ref/heads/main`) return { object: { sha: state.sha } };
      if (method === "GET" && path.startsWith(`${prefix}/git/ref/heads/crewbie/plans/`)) {
        if (state.branch) return { object: { sha: "planning-commit" } };
        throw new GitHubError(404, null);
      }
      if (method === "GET" && path === `${prefix}/git/commits/${sha}`) return { tree: { sha: "base-tree" } };
      if (method === "POST" && path === `${prefix}/git/trees`) { state.tree = body.tree; return { sha: "planning-tree" }; }
      if (method === "POST" && path === `${prefix}/git/commits`) return { sha: state.nextCommit ?? "b".repeat(40) };
      if (method === "PATCH" && path.startsWith(`${prefix}/git/refs/heads/`)) {
        assert.equal(body.force, false);
        const files = { ...baseFiles, ...Object.fromEntries(state.tree.map((entry) => [entry.path, entry.content])) };
        state.snapshots.set(body.sha, files);
        state.pulls[0].head.sha = body.sha;
        state.diff = state.tree.filter((entry) => baseFiles[entry.path] !== entry.content).map((entry) => ({ filename: entry.path, status: "added", sha: blob(entry.content) }));
        state.pulls[0].changed_files = state.diff.length;
        return {};
      }
      if (method === "PATCH" && path === `${prefix}/pulls/13`) { Object.assign(state.pulls[0], body); return state.pulls[0]; }
      if (method === "POST" && path === "/graphql") {
        if (state.reviewStateFailure) throw new Error("Review-state API unavailable.");
        const action = body.query.includes("markPullRequestReadyForReview") ? "markPullRequestReadyForReview" : "convertPullRequestToDraft";
        const draft = action === "convertPullRequestToDraft";
        state.pulls[0].draft = draft;
        return { data: { [action]: { pullRequest: { isDraft: draft } } } };
      }
      if (method === "POST" && path === `${prefix}/actions/workflows/crewbie-plan.yml/dispatches`) return null;
      if (method === "POST" && path === `${prefix}/git/refs`) {
        if (body.ref === "refs/tags/crewbie/dispatch-lock") {
          if (state.lock) throw new GitHubError(409, null);
          state.lock = true;
        } else state.branch = true;
        return {};
      }
      if (method === "DELETE" && path === `${prefix}/git/refs/tags/crewbie/dispatch-lock`) { state.lock = false; return null; }
      if (method === "POST" && path === `${prefix}/labels`) { state.labels.push(body); return body; }
      if (method === "POST" && path === `${prefix}/issues`) {
        const issue = { ...body, number: 100 + state.executionIssues.length, state: "open" };
        state.executionIssues.push(issue);
        return issue;
      }
      const comments = /^\/repos\/example\/project\/issues\/(\d+)\/comments$/.exec(path);
      if (method === "POST" && comments) {
        const number = Number(comments[1]), items = state.comments.get(number) ?? [];
        const comment = { ...body, user: sender, created_at: "2026-09-22T10:06:00Z", updated_at: "2026-09-22T10:06:00Z" };
        items.push(comment); state.comments.set(number, items); return comment;
      }
      if (method === "POST" && path === `${prefix}/actions/workflows/crewbie-dispatch.yml/dispatches`) { state.dispatches++; return null; }
      if (method === "POST" && path === `${prefix}/pulls`) {
        if (state.createPullFailure) throw new Error("Unknown PR publication outcome.");
        state.snapshots.set("b".repeat(40), { ...baseFiles, ...Object.fromEntries(state.tree.map((entry) => [entry.path, entry.content])) });
        state.diff = state.tree.filter((entry) => baseFiles[entry.path] !== entry.content).map((entry) => ({ filename: entry.path, status: "added", sha: blob(entry.content) }));
        const pull = { number: 13, node_id: "PR_fixture", state: "open", merged: false, draft: body.draft, changed_files: state.diff.length,
          base: { ref: "main", repo: { full_name: cfg.repository } },
          html_url: "https://github.com/example/project/pull/13", body: body.body, head: { sha: "b".repeat(40), ref: body.head, repo: { full_name: cfg.repository } } };
        state.pulls = [pull];
        return pull;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  const candidate = {
    summary: "Propose catalogue paging with bounded requests and explicit retry.",
    questions: [], teamSuggestions: [],
    batch: { schemaVersion: 1, id: "model-id", spec: "Load a page at a time. Preserve cards and require explicit retry after failure.", tasks: [planned("paging")], approval: null },
  };
  const output = (value = candidate) => writeFile(join(root, ".crewbie-planning-output.txt"), JSON.stringify(value));
  const merge = () => {
    const files = { ...baseFiles, ...Object.fromEntries(state.tree.map((entry) => [entry.path, entry.content])) };
    state.snapshots.set("b".repeat(40), { ...files });
    state.snapshots.set("c".repeat(40), { ...files });
    state.sha = "c".repeat(40);
    state.diff = state.tree.filter((entry) => baseFiles[entry.path] !== entry.content)
      .map((entry) => ({ filename: entry.path, status: baseFiles[entry.path] === undefined ? "added" : "modified", sha: blob(entry.content) }));
    const pull = state.pulls[0];
    Object.assign(pull, { number: 13, merged: true, state: "closed", draft: false, merge_commit_sha: state.sha, merged_at: "2026-09-22T10:05:00Z", merged_by: sender, changed_files: state.diff.length, base: { ref: "main", repo: { full_name: cfg.repository } } });
    pull.head.sha = "b".repeat(40);
    state.reviews = [{ id: 1, state: "APPROVED", user: sender, commit_id: pull.head.sha, submitted_at: "2026-09-22T10:04:00Z" }];
    return parseConfig(JSON.parse(files[".crewbie/config.json"]));
  };
  return { cfg, root, event, state, client, candidate, output, merge };
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
  assert.match(prompt, /only writes the plan/);
  assert.match(prompt, /Attachments|attachments have NOT been fetched/);
  assert.match(prompt, /frontend/);
  assert.equal(f.state.writes.length, 0, "Preparation has no remote write capability.");
  await f.output();
  assert.match(await publishPlanning(f.root, f.client, f.cfg), /pull\/13/);
  assert.deepEqual(f.state.tree.map((entry) => entry.path), [".crewbie/plans/progressive-catalogue-loading-issue-12/setup.json", ".crewbie/plans/progressive-catalogue-loading-issue-12/plan.md", ".crewbie/plans/progressive-catalogue-loading-issue-12/batch.json"]);
  const batch = JSON.parse(f.state.tree.find((entry) => entry.path.endsWith("batch.json")).content);
  assert.equal(batch.approval, null);
  assert.equal(batch.tasks[0].owner, "developer");
  assert.deepEqual(batch.sources, [{ uri: "https://github.com/example/project/issues/12", revision: f.state.source.updated_at, fingerprint: hash(`${f.state.source.title}\n\n${f.state.source.body}`) }]);
  assert.equal(f.state.writes.at(-1).body.draft, false);
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

test("model output supports clarification and team suggestions, but cannot change the team, self-approve or use unknown owners", async (t) => {
  const f = await planningFixture(t);
  const source = { ...f.state.source, revision: f.state.source.updated_at, labelEvent: 77 };
  const role = { id: "catalogue-performance", purpose: "Own catalogue query performance.", model: "proposed-model", checks: ["Measure bounded query work."], nonNegotiables: ["Preserve stable paging contracts."] };
  const custom = { ...f.candidate, teamSuggestions: ["A catalogue performance specialist could own query budgets."] };
  const plan = parsePlan({ ...custom, roles: [role] }, f.cfg, source);
  assert.equal(plan.batch.tasks[0].owner, "developer");
  assert.equal(plan.roles, undefined, "Returned roles are ignored; planning never changes the team.");
  assert.deepEqual(plan.teamSuggestions, custom.teamSuggestions);
  assert.throws(() => parsePlan({ ...custom, batch: { ...custom.batch, tasks: [{ ...task("query"), owner: role.id, model: role.model }] } }, f.cfg, source), /owner\/model/);
  assert.throws(() => parsePlan({ ...custom, teamSuggestions: ["a", "b", "c", "d"] }, f.cfg, source), /three team suggestions/);
  const sourceOnly = parsePlan({ ...custom, batch: { ...custom.batch, spec: "Invented requirements that the user never supplied." } }, f.cfg, source).batch;
  assert.match(sourceOnly.spec, /https:\/\/github.com\/example\/project\/issues\/12/);
  assert.doesNotMatch(sourceOnly.spec, /Invented requirements/);
  const { spec: _unused, ...withoutSpec } = custom.batch;
  assert.equal(parsePlan({ ...custom, batch: withoutSpec }, f.cfg, source).batch.spec, sourceOnly.spec);
  assert.equal(parsePlan({ ...custom, batch: null, questions: ["Which catalogue sort order is required?"] }, f.cfg, source).batch, null);
  assert.throws(() => parsePlan({ ...custom, batch: null }, f.cfg, source), /clarification/);
  assert.throws(() => parsePlan({ ...custom, batch: { ...custom.batch, approval: { digest: "fake", execute: true } } }, f.cfg, source), /cannot approve/);
  assert.throws(() => parsePlan({ ...custom, batch: { ...custom.batch, tasks: [{ ...task("wrong-model"), model: "other-model" }] } }, f.cfg, source), /owner\/model/);
  assert.throws(() => parsePlan({ ...custom, summary: "word ".repeat(101) }, f.cfg, source), /100 words/);
  assert.throws(() => parsePlan({ ...custom, summary: "-----BEGIN PRIVATE KEY-----" }, f.cfg, source), /secret/);
});

test("published plans list team suggestions without writing team files", async (t) => {
  const f = await planningFixture(t);
  await preparePlanning(f.root, f.client, f.cfg, f.event);
  await f.output({ ...f.candidate, teamSuggestions: ["Consider a catalogue performance specialist."], roles: [{ id: "new-role" }] });
  await publishPlanning(f.root, f.client, f.cfg);
  assert.ok(f.state.tree.every((entry) => entry.path.startsWith(".crewbie/plans/")));
  assert.match(f.state.tree.find((entry) => entry.path.endsWith("plan.md")).content, /Team suggestions \(not applied\)[\s\S]*catalogue performance/);
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
  assert.deepEqual(flow.on.issue_comment.types, ["created"]);
  assert.match(flow.jobs.prepare.if, /issue_comment.*pull_request.*Bot/);
  assert.match(flow.jobs.prepare.if, /crewbie:ready-for-planning/);
  assert.equal(flow.jobs.prepare.permissions.contents, "read");
  assert.equal(flow.jobs.prepare.permissions.actions, "read", "Preparation verifies its GitHub Actions run provenance.");
  assert.deepEqual(flow.jobs.analyze.permissions, { "copilot-requests": "write" });
  assert.equal(flow.jobs.publish.permissions.contents, "write");
  assert.equal(flow.jobs.publish.permissions.issues, "read");
  assert.equal(flow.jobs.publish.permissions.actions, "read", "Publication rechecks its GitHub Actions run provenance.");
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

test("description budgets are checked before remote writes", async (t) => {
  const f = await planningFixture(t);
  const cfg = { ...f.cfg, limits: { ...f.cfg.limits, pr: 30 } };
  await preparePlanning(f.root, f.client, cfg, f.event);
  await f.output();
  await assert.rejects(publishPlanning(f.root, f.client, cfg), /30 words/);
  assert.equal(f.state.writes.length, 0);
});

async function mergedFixture(t, unchangedPaths = []) {
  const f = await planningFixture(t, true);
  f.candidate.batch.tasks = [planned("catalogue-ui")];
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  for (const path of unchangedPaths) {
    f.state.snapshots.get(f.state.sha)[path] = f.state.tree.find((entry) => entry.path === path).content;
  }
  const active = f.merge();
  f.state.writes = [];
  return { ...f, active };
}

test("merge-enabled planning adds only plan files and verifies the exact human-reviewed merge", async (t) => {
  const f = await mergedFixture(t);
  assert.deepEqual(f.state.tree.map((entry) => entry.path).sort(), ["batch.json", "execution.json", "plan.md", "setup.json"].map((name) => `.crewbie/plans/progressive-catalogue-loading-issue-12/${name}`));
  const proof = await approvedMergedPlan(f.client, f.active, 13);
  assert.equal(proof.batch.approval.execute, true);
  assert.equal(proof.approver, "maintainer");
  assert.equal(proof.batch.tasks[0].owner, "developer");
  assert.equal(f.state.writes.length, 0, "Authorization is read-only.");
});

test("merge execution accepts an unchanged setup listed in the manifest but absent from the PR diff", async (t) => {
  const path = ".crewbie/plans/progressive-catalogue-loading-issue-12/setup.json";
  const f = await mergedFixture(t, [path]);
  const manifest = JSON.parse(f.state.snapshots.get("b".repeat(40))[".crewbie/plans/progressive-catalogue-loading-issue-12/execution.json"]);
  assert.ok(manifest.files[path]);
  assert.ok(!f.state.diff.some((file) => file.filename === path));
  assert.equal(Object.keys(manifest.files).length + 1, f.state.diff.length + 1);
  const proof = await approvedMergedPlan(f.client, f.active, 13);
  assert.equal(proof.batch.approval.execute, true);
  assert.equal(f.state.writes.length, 0);
});

test("unchanged plan and batch contents remain verified and available for publication", async (t) => {
  const f = await mergedFixture(t, ["setup.json", "plan.md", "batch.json"].map((name) => `.crewbie/plans/progressive-catalogue-loading-issue-12/${name}`));
  assert.match(await releaseMergedPlan(f.client, f.active, 13), /dispatch requested/);
  assert.equal(f.state.executionIssues.length, 1);
  assert.equal(f.state.dispatches, 1);
});

test("manifest files omitted from the PR diff must exist unchanged at the planning base", async (t) => {
  const path = ".crewbie/plans/progressive-catalogue-loading-issue-12/setup.json";
  const f = await mergedFixture(t, [path]);
  const base = f.state.snapshots.get(f.state.run.head_sha);
  const saved = base[path];
  base[path] += " ";
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /file coverage/);
  delete base[path];
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /file coverage/);
  base[path] = saved;
  const head = f.state.snapshots.get("b".repeat(40));
  base[path] = head[path] = `${saved} `;
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /changed after generation/);
  assert.equal(f.state.writes.length, 0);
});

test("unchanged manifest files cannot change at merge or on the current default branch", async (t) => {
  const path = ".crewbie/plans/progressive-catalogue-loading-issue-12/setup.json";
  const f = await mergedFixture(t, [path]);
  const merged = f.state.snapshots.get("c".repeat(40));
  const saved = merged[path];
  merged[path] += " ";
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /changed at merge or afterwards/);
  merged[path] = saved;
  f.state.sha = "d".repeat(40);
  f.state.snapshots.set(f.state.sha, { ...merged, [path]: `${saved} ` });
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /changed at merge or afterwards/);
  assert.equal(f.state.writes.length, 0);
});

test("unchanged manifest entries cannot authorize unrelated files", async (t) => {
  const f = await mergedFixture(t);
  const manifestPath = ".crewbie/plans/progressive-catalogue-loading-issue-12/execution.json";
  const path = ".github/workflows/unsafe.yml";
  const content = "name: Unrelated workflow\n";
  const head = f.state.snapshots.get("b".repeat(40));
  const manifest = JSON.parse(head[manifestPath]);
  manifest.files[path] = hash(content);
  for (const revision of [f.state.run.head_sha, "b".repeat(40), "c".repeat(40)]) {
    f.state.snapshots.get(revision)[path] = content;
  }
  for (const revision of ["b".repeat(40), "c".repeat(40)]) {
    f.state.snapshots.get(revision)[manifestPath] = JSON.stringify(manifest);
  }
  f.state.diff.find((file) => file.filename === manifestPath).sha =
    (await f.client.request("GET", `/repos/example/project/contents/${manifestPath}?ref=${"b".repeat(40)}`)).sha;
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /non-plan file/);
  assert.equal(f.state.writes.length, 0);
});

test("missing, duplicate, renamed and removed PR diff entries cannot authorize execution", async (t) => {
  const f = await mergedFixture(t);
  const original = structuredClone(f.state.diff);
  for (const diff of [
    original.slice(1),
    original.filter((file) => !file.filename.endsWith("execution.json")),
    [original[0], ...original.slice(0, -1)],
    original.map((file, index) => index === 0 ? { ...file, status: "removed" } : file),
    original.map((file, index) => index === 0 ? { ...file, previous_filename: "other.json" } : file),
  ]) {
    f.state.diff = diff;
    f.state.pulls[0].changed_files = diff.length;
    await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /file coverage|unapproved change/);
  }
  f.state.diff = original.slice(1);
  f.state.pulls[0].changed_files = original.length;
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /file coverage/);
  assert.equal(f.state.writes.length, 0);
});

test("approved merge automatically publishes specialist issues, records provenance and requests guarded dispatch idempotently", async (t) => {
  const f = await mergedFixture(t);
  assert.match(await releaseMergedPlan(f.client, f.active, 13), /dispatch requested/);
  assert.equal(f.state.executionIssues.length, 1);
  assert.ok(f.state.executionIssues[0].labels.includes("crewbie:owner:developer"));
  assert.equal(f.state.comments.get(100).length, 2);
  assert.match(f.state.comments.get(100)[0].body, /Execution: approved/);
  assert.match(f.state.comments.get(100)[1].body, /approval and maintainer's merge/);
  assert.equal(f.state.dispatches, 1);
  assert.deepEqual(f.state.writes.at(-1).body.inputs, { issue_numbers: "100" });
  assert.equal(f.state.lock, false);
  await releaseMergedPlan(f.client, f.active, 13);
  assert.equal(f.state.executionIssues.length, 1);
  assert.equal(f.state.comments.get(100).length, 2);
  assert.equal(f.state.dispatches, 2, "Dispatch reconciliation can repeat; native launch claims remain authoritative.");
});

test("merge alone, stale or bot approval, dismissed reviews and unresolved change requests cannot launch work", async (t) => {
  const f = await mergedFixture(t);
  const approved = structuredClone(f.state.reviews[0]);
  for (const reviews of [
    [],
    [{ ...approved, commit_id: "a".repeat(40) }],
    [{ ...approved, user: { login: "maintainer", type: "Bot" } }],
    [{ ...approved, submitted_at: "2026-09-22T10:06:00Z" }],
    [{ ...approved, state: "DISMISSED" }],
    [approved, { ...approved, id: 2, state: "CHANGES_REQUESTED" }],
  ]) {
    f.state.reviews = reviews;
    await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /approve the exact|requests changes/);
  }
  assert.equal(f.state.writes.length, 0);
});

test("execution cannot bootstrap approvers or merge permission from the planning PR", async (t) => {
  const f = await mergedFixture(t);
  await assert.rejects(releaseMergedPlan(f.client, { ...f.active, approvers: ["attacker", "maintainer"] }, 13), /cannot grant itself/);
  await assert.rejects(releaseMergedPlan(f.client, { ...f.active, planning: { ...f.active.planning, executeOnMerge: false } }, 13), /not enabled/);
  f.state.pulls[0].merged_by = { login: "outsider", type: "User" };
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /human approver must merge/);
  assert.equal(f.state.writes.length, 0);
});

test("default-branch planning provenance must be successful and cannot reference a fork or unrelated workflow", async (t) => {
  const f = await mergedFixture(t);
  const original = structuredClone(f.state.run);
  for (const changes of [
    { conclusion: "failure" }, { status: "in_progress" }, { event: "pull_request" },
    { path: ".github/workflows/untrusted.yml" }, { head_branch: "feature" },
    { actor: { login: "outsider", type: "User" } }, { head_repository: { full_name: "attacker/project" } },
    { triggering_actor: { login: "outsider", type: "User" } },
  ]) {
    f.state.run = { ...original, ...changes };
    await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /planning|Planning|policy/);
  }
  assert.equal(f.state.writes.length, 0);
});

test("tampering, merge conflict changes, extra files and stale source requirements stop before publication", async (t) => {
  const f = await mergedFixture(t);
  const merge = f.state.snapshots.get("c".repeat(40));
  const batchPath = ".crewbie/plans/progressive-catalogue-loading-issue-12/batch.json";
  const saved = merge[batchPath];
  merge[batchPath] += " ";
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /changed at merge/);
  merge[batchPath] = saved;
  f.state.diff.push({ filename: ".github/workflows/unsafe.yml", status: "added", sha: "e".repeat(40) });
  f.state.pulls[0].changed_files++;
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /file coverage/);
  f.state.diff.pop(); f.state.pulls[0].changed_files--;
  f.state.source.body += " New scope.";
  await assert.rejects(releaseMergedPlan(f.client, f.active, 13), /Source changed/);
  assert.equal(f.state.writes.length, 0);
});

test("clarification-only plans and missing workflow identity cannot opt themselves into execution", async (t) => {
  const f = await planningFixture(t, true);
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, f.event), /trusted GitHub planning-run/);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output({ ...f.candidate, batch: null, questions: ["Which products should be included?"] });
  await publishPlanning(f.root, f.client, f.cfg);
  assert.ok(!f.state.tree.some((entry) => entry.path.endsWith("execution.json") || entry.path === ".crewbie/config.json"));
  const active = f.merge();
  f.state.writes = [];
  await assert.rejects(releaseMergedPlan(f.client, active, 13), /no executable planning manifest/);
  assert.equal(f.state.writes.length, 0);
});

test("merge execution workflow is opt-in and checks out only the trusted default branch", () => {
  assert.equal(YAML.parse(workflows(false, true, false)[".github/workflows/crewbie-execute-plan.yml"]).on.pull_request_target, undefined);
  const workflow = YAML.parse(workflows(false, true, true)[".github/workflows/crewbie-execute-plan.yml"]);
  assert.deepEqual(workflow.on.pull_request_target.types, ["closed"]);
  assert.match(workflow.jobs.release.if, /merged == true/);
  assert.equal(workflow.jobs.release.steps[0].with.ref, "${{ github.event.repository.default_branch }}");
  const step = workflow.jobs.release.steps.find((step) => step.name?.startsWith("Verify human approval"));
  assert.equal(step.env.GH_TOKEN, "${{ secrets.CREWBIE_USER_TOKEN }}");
  assert.match(step.run, /No credential fallback/);
  assert.match(step.run, /internal-release-plan/);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.throws(() => parseConfig(config({ planning: { enabled: false, model: "", executeOnMerge: true } })), /Enable planning/);
});

test("planning locations support readable feature names and already-published legacy plans", () => {
  const key = "a".repeat(16);
  assert.deepEqual(planningLocation(`crewbie/plans/issue-12-${key}`), { sourceIssue: 12, keyPrefix: key, directory: ".crewbie/plans/issue-12" });
  assert.equal(planningLocation(`crewbie/plans/catalogue-paging-issue-12-${key}`).directory, ".crewbie/plans/catalogue-paging-issue-12");
  assert.throws(() => planningLocation(`crewbie/plans/../../unsafe-issue-12-${key}`), /generated planning branch/);
});

test("explicit same-PR revision reuses context, updates provenance and never force-pushes", async (t) => {
  const f = await planningFixture(t, true);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  f.state.writes = [];
  assert.match(await requestPlanningRevision(f.client, f.cfg, 13, "Split the paging UI from retry behavior.", false), /Preview.*billable/);
  assert.equal(f.state.writes.length, 0);
  await requestPlanningRevision(f.client, f.cfg, 13, "Split the paging UI from retry behavior.", true);
  const requested = f.state.writes.at(-1);
  assert.equal(requested.path, "/repos/example/project/actions/workflows/crewbie-plan.yml/dispatches");
  assert.equal(requested.body.inputs.head, "b".repeat(40));
  f.state.run.event = "workflow_dispatch";
  const event = { repository: f.event.repository, sender: f.event.sender, inputs: requested.body.inputs };
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, event, 43)).ready, true);
  const prompt = await readFile(join(f.root, ".crewbie-planning-prompt.txt"), "utf8");
  assert.match(prompt, /fresh repository assessment was intentionally skipped/);
  assert.match(prompt, /Split the paging UI from retry behavior/);
  await f.output({ ...f.candidate, summary: "Separate retry behavior from the catalogue UI." });
  f.state.nextCommit = "d".repeat(40);
  f.state.writes = [];
  assert.match(await publishPlanning(f.root, f.client, f.cfg), /Revised the same planning PR/);
  assert.equal(f.state.pulls[0].head.sha, "d".repeat(40));
  assert.ok(f.state.writes.every((write) => write.path !== "/repos/example/project/pulls"));
  const commit = f.state.writes.find((write) => write.path.endsWith("/git/commits"));
  assert.deepEqual(commit.body.parents, ["b".repeat(40)]);
  const manifest = JSON.parse(f.state.tree.find((entry) => entry.path.endsWith("/execution.json")).content);
  assert.equal(manifest.runId, 43);
  assert.equal(JSON.parse(f.state.tree.find((entry) => entry.path.endsWith("/batch.json")).content).approval, null);
  const writes = f.state.writes.length;
  assert.match(await publishPlanning(f.root, f.client, f.cfg), /already published/);
  assert.equal(f.state.writes.length, writes);
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, event, 43)).ready, false, "A completed run must skip another paid analysis even though its old head is now stale.");
  assert.equal(f.state.writes.length, writes);
});

test("stale, unrelated, untrusted and oversized planning revision requests stop before analysis", async (t) => {
  const f = await planningFixture(t, true);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  const event = { repository: f.event.repository, sender: f.event.sender,
    inputs: { pr: "13", feedback: "Keep retries explicit.", head: "a".repeat(40) } };
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, event, 43), /changed after the revision request/);
  event.inputs.head = "b".repeat(40);
  event.sender = { login: "outsider", type: "User" };
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, event, 43)).ready, false);
  await assert.rejects(requestPlanningRevision(f.client, f.cfg, 13, "x".repeat(8001), false), /8000/);
  f.state.diff.push({ filename: "src/unrelated.ts", status: "added" });
  f.state.pulls[0].changed_files++;
  await assert.rejects(requestPlanningRevision(f.client, f.cfg, 13, "Revise scope.", true), /unrelated change/);
});

test("planning revisions require the exact requested head and source before paid analysis", async (t) => {
  const f = await planningFixture(t, true);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  await requestPlanningRevision(f.client, f.cfg, 13, "Keep retries explicit.", true);
  const inputs = f.state.writes.at(-1).body.inputs;
  f.state.run.event = "workflow_dispatch";
  const event = { repository: f.event.repository, sender: f.event.sender, inputs };
  const writes = f.state.writes.length;
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, { ...event, inputs: { ...inputs, head: undefined } }, 43), /changed after the revision request/);
  f.state.source.body += " Add an unrelated feature.";
  await assert.rejects(preparePlanning(f.root, f.client, f.cfg, event, 43), /Source changed/);
  await assert.rejects(readFile(join(f.root, ".crewbie-planning-prompt.txt")), /ENOENT/);
  assert.equal(f.state.writes.length, writes);
});

test("clarification revisions become ready for review and report partial metadata failures without repeating analysis", async (t) => {
  for (const fail of [false, true]) {
    const f = await planningFixture(t, true);
    await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
    await f.output({ ...f.candidate, questions: ["Which paging size should be used?"], batch: null });
    await publishPlanning(f.root, f.client, f.cfg);
    assert.equal(f.state.pulls[0].draft, true);
    await requestPlanningRevision(f.client, f.cfg, 13, "Use 20 items per page.", true);
    const event = { repository: f.event.repository, sender: f.event.sender, inputs: f.state.writes.at(-1).body.inputs };
    f.state.run.event = "workflow_dispatch";
    await preparePlanning(f.root, f.client, f.cfg, event, 43);
    await f.output({ ...f.candidate, summary: Array(100).fill("Plan").join(" ") });
    f.state.nextCommit = "d".repeat(40);
    f.state.reviewStateFailure = fail;
    if (fail) await assert.rejects(publishPlanning(f.root, f.client, f.cfg), /Revision published.*draft\/ready state/);
    else {
      await publishPlanning(f.root, f.client, f.cfg);
      assert.equal(f.state.pulls[0].draft, false);
    }
    assert.equal(f.state.pulls[0].head.sha, "d".repeat(40));
    assert.equal((await preparePlanning(f.root, f.client, f.cfg, event, 43)).ready, false);
  }
});

test("an approver's reply to the plan's questions revises the same PR; other comments never start paid analysis", async (t) => {
  const f = await planningFixture(t, true);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output({ ...f.candidate, questions: ["Which paging size should be used?"], batch: null });
  await publishPlanning(f.root, f.client, f.cfg);
  const asked = f.state.comments.get(13).at(-1).body;
  assert.match(asked, /1\. Which paging size should be used\?[\s\S]*Reply in a comment on this PR/);
  assert.match(f.state.pulls[0].body, /crewbie-plan-questions/);
  f.state.run.event = "issue_comment";
  const reply = (body, sender = f.event.sender) => ({ action: "created", repository: f.event.repository, sender,
    issue: { number: 13, pull_request: { url: "x" } }, comment: { body, user: sender } });
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, reply("Use 20.", { login: "outsider", type: "User" }), 43)).ready, false);
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, reply(asked), 43)).ready, false, "Crewbie's own comment never triggers.");
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, { ...reply("Use 20."), action: "edited" }, 43)).ready, false);
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, reply("Use 20 items per page."), 43)).ready, true);
  const prompt = await readFile(join(f.root, ".crewbie-planning-prompt.txt"), "utf8");
  assert.match(prompt, /answers to the previous plan's questions:\\nUse 20 items per page\./);
  await f.output();
  f.state.nextCommit = "d".repeat(40);
  assert.match(await publishPlanning(f.root, f.client, f.cfg), /Revised the same planning PR/);
  assert.equal(f.state.pulls[0].draft, false);
  assert.doesNotMatch(f.state.pulls[0].body, /crewbie-plan-questions/);
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, reply("Looks good."), 44)).ready, false, "Without open questions a plain comment is not a revision.");
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, reply("/crewbie revise Split retries into their own task."), 44)).ready, true);
  assert.match(await readFile(join(f.root, ".crewbie-planning-prompt.txt"), "utf8"), /Feedback: "Split retries into their own task\."/);
});

test("a revision of a plan behind the default branch merges it in instead of asking for a manual branch update", async (t) => {
  const f = await planningFixture(t, true);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  f.state.mergeBase = "e".repeat(40);
  await requestPlanningRevision(f.client, f.cfg, 13, "Split retries.", true);
  f.state.run.event = "workflow_dispatch";
  const event = { repository: f.event.repository, sender: f.event.sender, inputs: f.state.writes.at(-1).body.inputs };
  assert.equal((await preparePlanning(f.root, f.client, f.cfg, event, 43)).ready, true);
  await f.output();
  f.state.nextCommit = "d".repeat(40);
  f.state.writes = [];
  await publishPlanning(f.root, f.client, f.cfg);
  const commit = f.state.writes.find((write) => write.path.endsWith("/git/commits"));
  assert.deepEqual(commit.body.parents, ["b".repeat(40), f.state.sha]);
  assert.ok(f.state.writes.every((write) => write.body?.force !== true));
});

test("a planning PR edited during publication is never overwritten", async (t) => {
  const f = await planningFixture(t, true);
  await preparePlanning(f.root, f.client, f.cfg, f.event, 42);
  await f.output();
  await publishPlanning(f.root, f.client, f.cfg);
  await requestPlanningRevision(f.client, f.cfg, 13, "Keep retries explicit.", true);
  const event = { repository: f.event.repository, sender: f.event.sender, inputs: f.state.writes.at(-1).body.inputs };
  f.state.run.event = "workflow_dispatch";
  await preparePlanning(f.root, f.client, f.cfg, event, 43);
  await f.output();
  let reads = 0;
  const racingClient = {
    ...f.client,
    async request(method, path, body) {
      const result = structuredClone(await f.client.request(method, path, body));
      if (method === "GET" && path === "/repos/example/project/pulls/13" && ++reads === 2) result.body += "\nHuman edit.";
      return result;
    },
  };
  f.state.writes = [];
  await assert.rejects(publishPlanning(f.root, racingClient, f.cfg), /changed before publication/);
  assert.equal(f.state.pulls[0].head.sha, "b".repeat(40));
  assert.ok(f.state.writes.every((write) => write.method !== "PATCH"));
});
