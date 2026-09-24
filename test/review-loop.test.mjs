import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewPlan, parseReviewReport, reconcileReview as runReview } from "../dist/execution/review-loop.js";
import { attributedBody, attributePull } from "../dist/execution/attribution.js";
import { selectNativeTask } from "../dist/execution/dispatch.js";
import { GitHubError } from "../dist/execution/github.js";
import { issueBody, issueDigest } from "../dist/specification/batch.js";
import { approvalComment } from "../dist/tracking/issues.js";
import { config, batch, task } from "./helpers.mjs";

const A = "a".repeat(40), B = "b".repeat(40);
const reconcileReview = (client, cfg, plan, ado) => runReview(client, cfg, plan, ado, async () => [{ id: "approved-model", name: "Approved model" }]);
function fixture() {
  const cfg = config({ roles: [
    { id: "frontend", purpose: "UI", model: "approved-model" },
    { id: "reviewer", purpose: "Review", model: "approved-model" },
  ] });
  const tasks = [{ ...task("ui"), owner: "frontend" }, { ...task("review", ["ui"]), owner: "reviewer", kind: "review" }];
  const b = { ...batch(), tasks };
  const issues = tasks.map((t, i) => ({ number: i + 1, title: t.title, body: issueBody(b, t), state: "open", labels: ["crewbie:managed"] }));
  const actor = { type: "User", login: "maintainer" };
  const comments = new Map(issues.map((issue) => [issue.number, [{
    user: actor, created_at: "same", updated_at: "same", body: approvalComment(issueDigest(issue.title, issue.body), true),
  }]]));
  const pulls = new Map([[10, { id: 100, number: 10, state: "open", body: "Feature.", user: { login: "Copilot" }, head: { sha: A, ref: "copilot/ui", repo: { full_name: "example/project" } }, base: { ref: "main" } }]]);
  const native = [{ id: "original", state: "completed", artifacts: [{ provider: "github", type: "pull", data: { id: 100 } }] }];
  const reviews = [];
  const writes = [];
  const launches = new Set(["refs/tags/crewbie/launches/feature/ui/1/1"]);
  let saved = null, revision = null, tree = null, locked = false;
  const f = { cfg, issues, comments, pulls, native, reviews, writes, launches, paused: false, report: null, uncertain: false, wrongModel: false, outOfScope: false, extraClaims: [],
    plan: parseReviewPlan({ schemaVersion: 1, reviewer: { issue: 2, issueDigest: issueDigest(issues[1].title, issues[1].body) },
      targets: [{ issue: 1, pr: 10, issueDigest: issueDigest(issues[0].title, issues[0].body), allowedPaths: ["frontend/"] }], maxRounds: 2 }),
    get state() { return saved; },
    complete(id) {
      const job = native.find((job) => job.id === id);
      job.state = "completed";
      job.sessions = [{ state: "completed", model: f.wrongModel ? "wrong-model" : "sweagent-capi:approved-model", created_at: "2026-09-22T12:00:00Z" }];
      if (job.custom_agent.id === "crewbie-frontend") pulls.get(10).head.sha = B;
    },
    client: {
      async list(path) {
        if (path.includes("/git/matching-refs/tags/crewbie/launches/")) return [...launches].map((ref) => ({ ref }));
        if (path.endsWith("/git/matching-refs/tags/crewbie/claims/")) return [1, ...f.extraClaims].map((number) => ({ ref: `refs/tags/crewbie/claims/${number}` }));
        if (path.endsWith("/pulls?state=open")) return structuredClone([...pulls.values()]);
        const match = /\/(issues|pulls)\/(\d+)\/(comments|reviews|files)$/.exec(path);
        if (!match) throw new Error(`Unexpected list ${path}`);
        const number = Number(match[2]);
        if (match[3] === "comments") return structuredClone(comments.get(number) ?? []);
        if (match[3] === "reviews") return structuredClone(reviews.filter((r) => r.pr === number));
        if (match[3] === "files") return [{ filename: number === 10 ? (f.outOfScope ? ".github/workflows/unsafe.yml" : "frontend/page.ts") : number === 30 ? "frontend/e2e/workspace.spec.ts" : `.crewbie/reviews/${saved.digest.slice(0, 20)}.json` }];
      },
      async request(method, path, body) {
        if (method !== "GET") writes.push({ method, path, body: structuredClone(body) });
        if (path.endsWith("/git/ref/tags/crewbie/paused")) {
          if (!f.paused) throw new GitHubError(404, null);
          return {};
        }
        if (path.includes("/contents/.github/agents/")) return { type: "file", sha: A };
        if (method === "POST" && path.endsWith("/git/refs") && body.ref.includes("/crewbie/launches/")) {
          if (launches.has(body.ref)) throw new GitHubError(422, null);
          launches.add(body.ref); return {};
        }
        if (path === "/user") return actor;
        if (path === "/repos/example/project") return { default_branch: "main" };
        if (path.endsWith("/branches/main")) return { commit: { sha: A } };
        if (path.endsWith("/git/matching-refs/tags/crewbie/claims/")) return [1, ...f.extraClaims].map((number) => ({ ref: `refs/tags/crewbie/claims/${number}` }));
        if (path.includes("/git/ref/tags/crewbie/claims/")) return {};
        if (path.endsWith("/git/refs") && body.ref.endsWith("dispatch-lock")) { assert.equal(locked, false); locked = true; return {}; }
        if (method === "DELETE" && path.endsWith("dispatch-lock")) { locked = false; return null; }
        if (path.includes("/git/ref/heads/crewbie/review-state/")) {
          if (!revision) throw new GitHubError(404, null);
          return { object: { sha: revision } };
        }
        if (path.includes("/contents/state.json")) return { encoding: "base64", content: Buffer.from(JSON.stringify(saved)).toString("base64") };
        if (path.endsWith("/git/trees")) { tree = JSON.parse(body.tree[0].content); return { sha: A }; }
        if (path.endsWith("/git/commits")) return { sha: (Number.parseInt(revision?.slice(-6) ?? "0", 16) + 1).toString(16).padStart(40, "0") };
        if (path.includes("/git/refs/heads/crewbie/review-state/") || (path.endsWith("/git/refs") && body.ref?.includes("review-state"))) { revision = body.sha; saved = structuredClone(tree); return {}; }
        if (path === "/graphql") {
          const number = { 1: 10, 2: 20, 3: 30 }[body.variables.number];
          return { data: { repository: { issue: { closedByPullRequestsReferences: {
            nodes: pulls.has(number) ? [{ number, repository: { nameWithOwner: "example/project" } }] : [], pageInfo: { hasNextPage: false, endCursor: null },
          } } } } };
        }
        if (path.startsWith("/agents/repos/example/project/tasks?")) return { tasks: structuredClone(native) };
        if (method === "POST" && path === "/agents/repos/example/project/tasks") {
          if (f.uncertain) throw new GitHubError(503, "unknown");
          const id = `native-${native.length}`;
          const pr = body.custom_agent === "crewbie-reviewer" ? 20 : body.custom_agent === "crewbie-tester" ? 30 : 10;
          if (!pulls.has(pr)) pulls.set(pr, { id: 200, number: 20, state: "open", body: "Review.", user: { login: "Copilot" }, head: { sha: A, ref: "copilot/review", repo: { full_name: "example/project" } }, base: { ref: "main" } });
          const created = { id, state: "in_progress", custom_agent: { id: body.custom_agent }, artifacts: [{ provider: "github", type: "pull", data: { id: pulls.get(pr).id } }] };
          native.push(created); return structuredClone(created);
        }
        if (path.startsWith("/agents/repos/example/project/tasks/")) return structuredClone(native.find((n) => n.id === path.split("/").at(-1)));
        if (path.includes("/contents/.crewbie/reviews/")) return { encoding: "base64", content: Buffer.from(JSON.stringify(f.report)).toString("base64") };
        const match = /\/(issues|pulls)\/(\d+)(.*)$/.exec(path);
        if (match) {
          const number = Number(match[2]), suffix = match[3];
          if (suffix === "/labels") { issues[number - 1].labels.push(...body.labels); return []; }
          if (method === "DELETE" && suffix.startsWith("/labels/")) { issues[number - 1].labels = issues[number - 1].labels.filter((label) => label !== decodeURIComponent(suffix.slice(8))); return null; }
          if (suffix === "/comments") { const list = comments.get(number) ?? []; list.push({ user: actor, created_at: "same", updated_at: "same", body: body.body }); comments.set(number, list); return {}; }
          if (suffix === "/reviews") { const review = { pr: number, id: reviews.length + 1, user: actor, ...body }; reviews.push(review); return review; }
          if (match[1] === "issues") return structuredClone(issues[number - 1]);
          if (method === "PATCH") Object.assign(pulls.get(number), body);
          return structuredClone(pulls.get(number));
        }
        throw new Error(`Unexpected request ${method} ${path}`);
      },
    },
  };
  return f;
}
const report = (head, verdict = "clean") => ({ schemaVersion: 1, targets: [{
  pr: 10, headSha: head, verdict, summary: "Executed regression check.",
  findings: verdict === "changes_requested" ? [{ path: "frontend/page.ts", line: 12, body: "Visible observer retries failures. Assert no request before explicit retry." }] : [],
}] });

test("review plan/report reject stale, contradictory, duplicate and out-of-scope findings", () => {
  const f = fixture();
  assert.equal(parseReviewReport(report(A), f.plan, { 10: A })[0].verdict, "clean");
  assert.throws(() => parseReviewReport(report(B), f.plan, { 10: A }), /stale/);
  const bad = report(A, "changes_requested"); bad.targets[0].findings[0].path = ".github/workflows/run.yml";
  assert.throws(() => parseReviewReport(bad, f.plan, { 10: A }), /scope/);
  bad.targets[0].findings = [];
  assert.throws(() => parseReviewReport(bad, f.plan, { 10: A }), /contradicts/);
  for (const path of [".github/", ".crewbie/", "../", "/", "./", ".git/config"]) assert.throws(() => parseReviewPlan({ ...f.plan, targets: [{ ...f.plan.targets[0], allowedPaths: [path] }] }));
});

test("real review publication drives bounded same-profile correction and exact-head re-review without merges", async () => {
  const f = fixture();
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.native[1].custom_agent.id, "crewbie-reviewer");
  assert.ok(f.issues[1].labels.includes("crewbie:running"));
  f.complete("native-1"); f.report = report(A, "changes_requested");
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "fix");
  assert.equal(f.reviews.length, 1); assert.equal(f.reviews[0].commit_id, A);
  await reconcileReview(f.client, f.cfg, f.plan);
  const correction = f.writes.filter((w) => w.path === "/agents/repos/example/project/tasks").at(-1).body;
  assert.equal(correction.custom_agent, "crewbie-frontend"); assert.equal(correction.model, "approved-model");
  assert.equal(correction.head_ref, "copilot/ui"); assert.equal(correction.create_pull_request, false);
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.native.length, 3, "An active correction is not relaunched.");
  f.complete("native-2");
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "review");
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.writes.filter((w) => w.path === "/agents/repos/example/project/tasks").at(-1).body.head_ref, "copilot/review");
  f.complete("native-3"); f.report = report(B);
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "clean");
  assert.equal(f.reviews.length, 2); assert.equal(f.reviews[1].commit_id, B);
  assert.ok(f.issues.every((issue) => issue.labels.includes("crewbie:review") && !issue.labels.includes("crewbie:running")));
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.reviews.length, 2, "Completed loop is idempotent.");
  assert.equal(f.native.length, 4);
  assert.match(f.pulls.get(10).body, /crewbie-frontend/);
  assert.match(f.pulls.get(10).body, /Closes #1/);
  assert.match(f.pulls.get(20).body, /Closes #2/);
  assert.ok(!f.writes.some((w) => /\/merge$/.test(w.path)));
  f.pulls.get(10).head.sha = A;
  await assert.rejects(reconcileReview(f.client, f.cfg, f.plan), /stale/);
});

test("uncertain native launches persist intent and never retry a paid write", async () => {
  const f = fixture(); f.uncertain = true;
  await assert.rejects(reconcileReview(f.client, f.cfg, f.plan), /503/);
  f.uncertain = false;
  await assert.rejects(reconcileReview(f.client, f.cfg, f.plan), /uncertain outcome/);
  assert.equal(f.writes.filter((w) => w.path === "/agents/repos/example/project/tasks").length, 1);
  assert.equal(f.launches.size, 2, "Unknown outcomes consume an attempt as well as preserving intent.");
});

test("review and correction launches share the same batch and task caps and pause gate", async () => {
  const f = fixture();
  f.cfg.execution = { maxLaunchesPerBatch: 2, maxAttemptsPerTask: 3 };
  await reconcileReview(f.client, f.cfg, f.plan);
  f.complete("native-1"); f.report = report(A, "changes_requested");
  await reconcileReview(f.client, f.cfg, f.plan);
  await assert.rejects(reconcileReview(f.client, f.cfg, f.plan), /Batch launch allowance exhausted/);
  assert.equal(f.native.length, 2);
  f.cfg.execution = { maxLaunchesPerBatch: 20, maxAttemptsPerTask: 1 };
  await assert.rejects(reconcileReview(f.client, f.cfg, f.plan), /Task attempt allowance exhausted/);
  f.cfg.execution.maxAttemptsPerTask = 3;
  f.paused = true;
  await assert.rejects(reconcileReview(f.client, f.cfg, f.plan), /paused/);
  assert.equal(f.native.length, 2);
  f.paused = false;
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.native.length, 3, "Resume preserves the same pending correction instead of starting a replacement loop.");
});

test("missing QA evidence does not prevent known fixes; tester refresh follows corrected heads", async () => {
  const f = fixture();
  f.cfg.roles.push({ id: "tester", purpose: "Verify", model: "approved-model" });
  const qa = { ...task("qa"), owner: "tester", kind: "review" };
  const issue = { number: 3, state: "open", title: qa.title, body: issueBody({ ...batch(), tasks: [qa] }, qa), labels: [] };
  f.issues.push(issue);
  f.comments.set(3, [{ user: { type: "User", login: "maintainer" }, created_at: "same", updated_at: "same", body: approvalComment(issueDigest(issue.title, issue.body), true) }]);
  f.pulls.set(30, { id: 300, number: 30, state: "open", body: "QA evidence pending.", user: { login: "Copilot" },
    head: { sha: A, ref: "copilot/qa", repo: { full_name: "example/project" } }, base: { ref: "main" } });
  f.plan.targets.push({ issue: 3, pr: 30, issueDigest: issueDigest(issue.title, issue.body), allowedPaths: ["frontend/e2e/"] });
  await reconcileReview(f.client, f.cfg, f.plan);
  f.complete("native-1");
  f.report = report(A, "changes_requested");
  f.report.targets.push({ pr: 30, headSha: A, verdict: "blocked", summary: "Needs current combined-head evidence.", findings: [] });
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "fix");
  // An older runner's blanket QA blocker can be resumed without repeating review.
  f.state.phase = "blocked"; f.state.reason = "Reviewer reported missing evidence or a scope decision."; f.state.round = 0; f.state.fixes = {};
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.native[2].custom_agent.id, "crewbie-frontend");
  f.complete("native-2");
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "verify");
  await reconcileReview(f.client, f.cfg, f.plan);
  assert.equal(f.native[3].custom_agent.id, "crewbie-tester");
  const request = f.writes.filter((w) => w.path === "/agents/repos/example/project/tasks").at(-1).body;
  assert.equal(request.head_ref, "copilot/qa");
  assert.match(request.prompt, new RegExp(B));
  f.complete("native-3");
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "review");
  await reconcileReview(f.client, f.cfg, f.plan);
  f.complete("native-4");
  f.report = report(B);
  f.report.targets.push({ pr: 30, headSha: A, verdict: "clean", summary: "Combined heads verified.", findings: [] });
  assert.equal((await reconcileReview(f.client, f.cfg, f.plan)).phase, "clean");
});

test("runtime model mismatch, scope drift, capacity and exhausted budgets stop safely", async () => {
  const capacity = fixture(); capacity.native[0].state = "in_progress"; capacity.cfg.maxActive = 1;
  await reconcileReview(capacity.client, capacity.cfg, capacity.plan);
  assert.equal(capacity.native.length, 1);
  const uncertain = fixture(); uncertain.extraClaims = [99]; uncertain.cfg.maxActive = 1;
  await reconcileReview(uncertain.client, uncertain.cfg, uncertain.plan);
  assert.equal(uncertain.native.length, 1, "An unresolved assignment elsewhere retains its capacity reservation.");
  const model = fixture();
  await reconcileReview(model.client, model.cfg, model.plan);
  model.wrongModel = true; model.complete("native-1"); model.report = report(A);
  await assert.rejects(reconcileReview(model.client, model.cfg, model.plan), /mismatched/);
  const drift = fixture(); drift.issues[0].body += "scope change";
  await assert.rejects(reconcileReview(drift.client, drift.cfg, drift.plan), /exact approved scope/);
  assert.equal(drift.native.length, 1);
  const limit = fixture(); limit.plan.maxRounds = 1;
  await reconcileReview(limit.client, limit.cfg, limit.plan);
  limit.complete("native-1"); limit.report = report(A, "changes_requested");
  await reconcileReview(limit.client, limit.cfg, limit.plan);
  await reconcileReview(limit.client, limit.cfg, limit.plan);
  limit.complete("native-2");
  limit.outOfScope = true;
  await assert.rejects(reconcileReview(limit.client, limit.cfg, limit.plan), /outside.*scope/);
  limit.outOfScope = false;
  await reconcileReview(limit.client, limit.cfg, limit.plan);
  await reconcileReview(limit.client, limit.cfg, limit.plan);
  limit.complete("native-3"); limit.report = report(B, "changes_requested");
  assert.equal((await reconcileReview(limit.client, limit.cfg, limit.plan)).phase, "blocked");
  assert.equal(limit.native.length, 4, "No third implementation session after the correction budget.");
});

test("attribution preserves prose, rejects races and never invents runtime profile selection", async () => {
  const body = attributedBody("Original rationale.", "crewbie-frontend", "approved-model", "https://github.com/example/project/tasks/task-1");
  assert.match(body, /Original rationale/);
  assert.equal(attributedBody(body, "crewbie-frontend", "approved-model", "https://github.com/example/project/tasks/task-1"), body);
  assert.throws(() => attributedBody(`${body}\n${body}`, "x", "y", "z"), /ambiguous/);
  const f = fixture(), pr = structuredClone(f.pulls.get(10));
  await assert.rejects(attributePull(f.client, f.cfg, pr, { id: "wrong" }, "frontend", "approved-model"), /did not confirm/);
  f.pulls.get(10).body = "Human edit.";
  await assert.rejects(attributePull(f.client, f.cfg, pr, { id: "task-1", custom_agent: { id: "crewbie-frontend" } }, "frontend", "approved-model"), /changed/);
});

test("multiple native tasks need an immutable trusted receipt covering the exact chain", async () => {
  const f = fixture(), matches = [{ id: "old", state: "completed" }, { id: "new", state: "completed" }];
  assert.equal(await selectNativeTask(f.client, f.cfg, 1, matches), undefined);
  const entry = { user: { type: "User", login: "maintainer" }, created_at: "same", updated_at: "same",
    body: `<!-- crewbie-continuation:${Buffer.from(JSON.stringify({ task: "new", previous: ["old"] })).toString("base64")} -->` };
  f.comments.get(1).push(entry);
  assert.equal((await selectNativeTask(f.client, f.cfg, 1, matches)).id, "new");
  entry.user.login = "untrusted";
  assert.equal(await selectNativeTask(f.client, f.cfg, 1, matches), undefined);
  entry.user.login = "maintainer"; entry.updated_at = "changed";
  assert.equal(await selectNativeTask(f.client, f.cfg, 1, matches), undefined);
  entry.updated_at = "same"; matches[0].state = "in_progress";
  assert.equal(await selectNativeTask(f.client, f.cfg, 1, matches), undefined);
});

test("attribution reposts the specialist's own PR description once after Copilot's summary replaced it", async () => {
  const { specialistNote } = await import("../dist/execution/attribution.js");
  const own = "Specialist: crewbie-frontend\n\n## What changed\nGrudgingly added favorites.\n\n<!-- START COPILOT CODING AGENT SUFFIX -->\n- Fixes #1";
  const edits = [
    { editor: "copilot-swe-agent", body: "Neutral final summary." },
    { editor: "copilot-swe-agent", body: own },
    { editor: "maintainer", body: "Specialist: crewbie-frontend\nhuman text" },
  ];
  assert.equal(specialistNote(edits, "crewbie-frontend"), "Specialist: crewbie-frontend\n\n## What changed\nGrudgingly added favorites.");
  assert.equal(specialistNote([edits[2]], "crewbie-frontend"), null, "human edits are never reposted as the specialist's voice");
  assert.equal(specialistNote([{ editor: "copilot-swe-agent", body: "<!-- crewbie-attribution -->\n**Specialist:** `crewbie-frontend`" }], "crewbie-frontend"), null);

  const comments = [];
  const pr = { number: 10, body: "Neutral final summary.", head: { sha: "h" }, state: "open" };
  const client = {
    async list(path) { if (path.endsWith("/issues/10/comments")) return comments; throw new Error(`Unexpected list ${path}`); },
    async request(method, path, body) {
      if (path === "/graphql") return { data: { repository: { pullRequest: { userContentEdits: { nodes: edits.map((edit) => ({ editor: { login: edit.editor }, diff: edit.body })) } } } } };
      if (method === "GET" && path.endsWith("/pulls/10")) return structuredClone(pr);
      if (method === "PATCH" && path.endsWith("/pulls/10")) { pr.body = body.body; return { body: body.body }; }
      if (method === "POST" && path.endsWith("/issues/10/comments")) { comments.push(body); return {}; }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  const cfg = { repository: "example/project" };
  const task = { id: "task-9", custom_agent: { id: "crewbie-frontend" } };
  await attributePull(client, cfg, structuredClone(pr), task, "frontend", "approved-model");
  await attributePull(client, cfg, structuredClone(pr), task, "frontend", "approved-model");
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /crewbie-specialist-note:task-9/);
  assert.match(comments[0].body, /> Grudgingly added favorites\./);
});
