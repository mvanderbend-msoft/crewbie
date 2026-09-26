import test from "node:test";
import assert from "node:assert/strict";
import { dispatch as runDispatch, linkedPull, preflight, renderDispatchResult } from "../dist/execution/dispatch.js";
import { GitHubError } from "../dist/execution/github.js";
import { approvedBatch, batchDigest, featureBranch, issueBody, issueDigest, parseBatch, taskMetadata } from "../dist/specification/batch.js";
import { watchBatch } from "../dist/execution/watch.js";
import { approvalComment } from "../dist/tracking/issues.js";
import { config, batch, task } from "./helpers.mjs";
import { parseReview, renderReview } from "../dist/execution/pr-review.js";
const models = async () => [{ id: "approved-model", name: "Approved model" }];
const BRANCH = featureBranch(parseBatch(batch(), config()));
const dispatch = (client, cfg, ado, scope) => runDispatch(client, cfg, ado, scope, models);

/** Issue body of a task published before feature branches: its metadata has no branch. */
function githubFixture(input = batch()) {
  const b = parseBatch(input, config());
  const issues = b.tasks.map((task, index) => ({
    number: index + 1, state: "open", title: task.title, body: issueBody(b, task),
    labels: ["crewbie:managed", "crewbie:blocked", "crewbie:owner:developer"],
  }));
  const claims = new Set(), pulls = new Map(), assignments = [], launches = new Set();
  let locked = false;
  const fixture = {
    issues, claims, pulls, assignments, launches, paused: false, cloudTasks: [], cloudStatusDenied: false, failAssignment: false, ignoreAssignment: false, extraComments: {},
    events: {}, posted: [], unassigned: [], readied: [], merges: [], reviews: [], checkRuns: [], statuses: [],
    prComments: {}, reviewRuns: [], reviewRequests: [], continuations: [], branches: new Set(), featurePulls: [], prPatches: [], sourceIssue: { title: "Requirement", body: "", updated_at: "source-v1" },
    get locked() { return locked; },
    client: {
      async list(path) {
        if (path.includes("/git/matching-refs/tags/crewbie/launches/")) return [...launches].filter((ref) => ref.startsWith(`refs/${path.split("/git/matching-refs/")[1]}`)).map((ref) => ({ ref }));
        if (path.endsWith("/git/matching-refs/tags/crewbie/claims/")) return [...claims].map((number) => ({ ref: `refs/tags/crewbie/claims/${number}` }));
        if (path.endsWith("/labels")) return ["managed", "ready-for-planning", "restart", "blocked", "ready", "running", "review", "failed", "done", "owner:developer"].map((name) => ({ name: `crewbie:${name}` }));
        if (path.includes("/issues?")) { const state = /state=(\w+)/.exec(path)?.[1] ?? "open", since = /since=([^&]+)/.exec(path)?.[1]; return structuredClone(issues.filter((issue) => (state === "all" || (issue.state ?? "open") === state) && !(since && issue.updated_at && issue.updated_at < since))); }
        const events = /\/issues\/(\d+)\/events$/.exec(path);
        if (events) return fixture.events[Number(events[1])] ?? [];
        if (path.includes("/pulls?state=all&head=")) {
          const head = decodeURIComponent(/head=([^&]+)/.exec(path)[1]).split(":")[1];
          return structuredClone(fixture.featurePulls.filter((pr) => pr.head.ref === head));
        }
        if (/\/pulls\/\d+\/files$/.test(path)) return fixture.prFiles ?? [];
        if (/\/pulls\/\d+\/reviews$/.test(path)) return fixture.reviews;
        if (/\/pulls\/\d+\/comments$/.test(path)) return [];
        const prComments = /\/issues\/(\d+)\/comments$/.exec(path);
        if (prComments && !issues.some((item) => item.number === Number(prComments[1]))) return fixture.prComments[Number(prComments[1])] ?? [];
        const match = /\/issues\/(\d+)\/(comments|timeline)$/.exec(path);
        if (match) {
          const issue = issues.find((item) => item.number === Number(match[1]));
          if (match[2] === "comments") return [{
            user: { type: "User", login: "maintainer" }, created_at: "same", updated_at: "same",
            body: approvalComment(issueDigest(issue.title, issue.body), true),
          }, ...(fixture.extraComments[issue.number] ?? []), ...fixture.posted.filter((item) => item.issue === issue.number).map((item) => item.comment)];
          const pr = pulls.get(issue.number);
          return pr ? [{ event: "cross-referenced", source: { issue: { pull_request: { url: `https://api.github.com/repos/example/project/pulls/${pr.number}` } } } }] : [];
        }
        throw new Error(`Unexpected list: ${path}`);
      },
      async request(method, path, body) {
        if (path.includes("/collaborators/")) return { permission: decodeURIComponent(path.split("/collaborators/")[1].split("/")[0]) === "maintainer" ? "write" : "read" };
        if (method === "POST" && path.endsWith("/tasks") && body?.base_ref === "crewbie/model-check-never-exists") { (fixture.modelChecks ??= []).push(body.model); throw new GitHubError(fixture.probeStatus ?? (fixture.rejectedModels?.includes(body.model) ? 400 : 412), null); }
        if (path.endsWith("/git/ref/tags/crewbie/paused")) {
          if (!fixture.paused) throw new GitHubError(404, null);
          return {};
        }
        if (method === "DELETE" && path.endsWith("/requested_reviewers")) { (fixture.withdrawn ??= []).push(...body.reviewers); return {}; }
        if (method === "POST" && path.endsWith("/requested_reviewers")) { (fixture.requested ??= []).push({ path, reviewers: body.reviewers }); return {}; }
        if (path === "/graphql" && body.query.includes("markPullRequestReadyForReview")) {
          const pr = [...pulls.values()].find((item) => item.node_id === body.variables.id);
          fixture.readied.push(pr.number); pr.draft = false;
          return { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } };
        }
        if (/\/commits\/[^/]+\/check-runs/.test(path)) return { total_count: fixture.checkRuns.length, check_runs: fixture.checkRuns };
        if (/\/commits\/[^/]+\/status$/.test(path)) return { statuses: fixture.statuses };
        const merge = /\/pulls\/(\d+)\/merge$/.exec(path);
        if (method === "PUT" && merge) {
          const pr = [...pulls.values()].find((item) => item.number === Number(merge[1]));
          fixture.merges.push({ number: pr.number, ...body }); pr.merged_at = "now"; pr.state = "closed";
          return { merged: true };
        }
        if (path === "/graphql") {
          const pr = pulls.get(body.variables.number);
          return { data: { repository: { issue: { closedByPullRequestsReferences: {
            nodes: pr ? [{ number: pr.number, repository: { nameWithOwner: "example/project" } }] : [],
            pageInfo: { hasNextPage: false, endCursor: null },
          } } } } };
        }
        if (path.includes("/actions/workflows/crewbie-review.yml/runs")) return { workflow_runs: fixture.reviewRuns };
        if (method === "POST" && path.endsWith("/actions/workflows/crewbie-review.yml/dispatches")) { fixture.reviewRequests.push(body); return null; }
        const run = /\/actions\/runs\/(\d+)$/.exec(path);
        if (run) return fixture.reviewRuns.find((item) => item.id === Number(run[1]));
        if (method === "POST" && path === "/agents/repos/example/project/tasks") { fixture.continuations.push(body); return { id: `task-${fixture.continuations.length + 1}` }; }
        if (path.startsWith("/agents/repos/example/project/tasks?")) {
          if (fixture.cloudStatusDenied) throw new GitHubError(403, "status-denied");
          return { tasks: fixture.cloudTasks };
        }
        if (path === "/repos/example/project") return { default_branch: "main" };
        if (path === "/repos/example/project/issues/73") return fixture.sourceIssue;
        if (path.endsWith("/branches/main")) return { commit: { sha: "base-sha" } };
        if (path.endsWith("/git/matching-refs/tags/crewbie/claims/")) return [...claims].map((number) => ({ ref: `refs/tags/crewbie/claims/${number}` }));
        if (path.includes("/contents/.github/agents/")) return { sha: "profile-sha", type: "file" };
        if (path.includes("/git/ref/tags/crewbie/claims/")) {
          if (!claims.has(Number(path.split("/").at(-1)))) throw new GitHubError(404, null);
          return {};
        }
        const head = /\/git\/ref\/heads\/(.+)$/.exec(path);
        if (head) { if (!fixture.branches.has(head[1])) throw new GitHubError(404, null); return { ref: `refs/heads/${head[1]}` }; }
        if (method === "POST" && path.endsWith("/pulls")) {
          const pr = { id: 9000 + fixture.featurePulls.length, number: 900 + fixture.featurePulls.length, state: "open", ...body, head: { ref: body.head, sha: `feature-${fixture.featurePulls.length}` }, base: { ref: body.base } };
          fixture.featurePulls.push(pr);
          return structuredClone(pr);
        }
        if (method === "POST" && path.endsWith("/git/refs")) {
          if (body.ref.startsWith("refs/heads/")) {
            if (fixture.branches.has(body.ref.slice(11))) throw new GitHubError(422, "exists");
            fixture.branches.add(body.ref.slice(11)); return {};
          }
          if (body.ref.includes("/crewbie/launches/")) {
            if (launches.has(body.ref)) throw new GitHubError(422, "reserved");
            launches.add(body.ref);
          } else if (body.ref.endsWith("/dispatch-lock")) {
            if (locked) throw new GitHubError(422, "locked");
            locked = true;
          } else {
            const number = Number(body.ref.split("/").at(-1));
            if (claims.has(number)) throw new GitHubError(422, "claimed");
            claims.add(number);
          }
          return {};
        }
        if (method === "DELETE" && path.endsWith("/dispatch-lock")) { locked = false; return null; }
        const match = /\/issues\/(\d+)(.*)$/.exec(path);
        const onPull = match && !issues.some((item) => item.number === Number(match[1])) ? [...pulls.values()].find((item) => item.number === Number(match[1])) : undefined;
        if (onPull && match[2] === "/comments" && method === "POST") {
          (fixture.prComments[onPull.number] ??= []).push({ user: { type: "User", login: "maintainer" }, created_at: `z${fixture.posted.length}`, updated_at: `z${fixture.posted.length}`, body: body.body });
          fixture.posted.push({ issue: onPull.number, comment: { body: body.body } });
          return {};
        }
        if (onPull && method === "DELETE" && match[2].startsWith("/labels/")) {
          onPull.labels = onPull.labels.filter((label) => label.name !== decodeURIComponent(match[2].slice(8))); return null;
        }
        if (match) {
          const issue = issues.find((item) => item.number === Number(match[1]));
          if (!match[2]) return structuredClone(issue);
          if (match[2] === "/comments" && method === "POST") {
            fixture.posted.push({ issue: issue.number, comment: { user: { type: "User", login: "maintainer" }, created_at: `z${fixture.posted.length}`, updated_at: `z${fixture.posted.length}`, body: body.body } });
            return {};
          }
          if (match[2] === "/assignees" && method === "DELETE") {
            fixture.unassigned.push(body);
            // GitHub shows the bot as "Copilot" but removes it only by its account login.
            const login = (name) => name === "Copilot" ? "copilot-swe-agent[bot]" : name;
            issue.assignees = (issue.assignees ?? []).filter((item) => !body.assignees.includes(login(item.login)));
            return structuredClone(issue);
          }
          if (match[2] === "/assignees") {
            assignments.push(body);
            if (fixture.failAssignment) throw new GitHubError(503, "unknown-outcome");
            issue.assignees = fixture.ignoreAssignment ? [] : [{ login: "copilot-swe-agent[bot]" }];
            return issue;
          }
          if (match[2] === "/labels") { issue.labels = [...new Set([...issue.labels, ...body.labels])]; return issue.labels; }
          if (method === "DELETE" && match[2].startsWith("/labels/")) {
            issue.labels = issue.labels.filter((label) => label !== decodeURIComponent(match[2].slice(8))); return null;
          }
        }
        const pr = /\/pulls\/(\d+)$/.exec(path);
        if (pr) {
          const found = [...pulls.values()].find((item) => item.number === Number(pr[1]));
          const feature = fixture.featurePulls.find((item) => item.number === Number(pr[1]));
          if (feature && method === "PATCH") { fixture.prPatches.push(body); Object.assign(feature, body); return structuredClone(feature); }
          // Task PRs of a feature plan target its feature branch unless a test says otherwise.
          if (found) return { base: { ref: featureBranch(b) }, ...found };
          if (feature) return structuredClone(feature);
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      },
    },
  };
  return fixture;
}

test("end-to-end dispatch requests named specialist/model, respects two slots and releases merged dependencies", async () => {
  const fixture = githubFixture();
  await dispatch(fixture.client, config());
  assert.equal(fixture.assignments.length, 2);
  assert.deepEqual([...fixture.claims], [1, 3]);
  assert.equal(fixture.assignments[0].agent_assignment.custom_agent, "crewbie-developer");
  assert.equal(fixture.assignments[0].agent_assignment.model, "approved-model");
  assert.equal(fixture.locked, false);
  await dispatch(fixture.client, config());
  assert.equal(fixture.assignments.length, 2, "reconciliation must not repeat paid assignments");
  fixture.pulls.set(1, { number: 101, merged_at: "2026-09-22", state: "closed", user: { login: "copilot-swe-agent[bot]" } });
  await dispatch(fixture.client, config());
  assert.equal(fixture.assignments.length, 3);
  assert.ok(fixture.claims.has(2));
});

test("empty dispatch explains disabled planning without assigning or claiming any work", async () => {
  const fixture = githubFixture();
  fixture.issues.splice(0);
  const policy = config({ planning: { enabled: false, model: "", executeOnMerge: false } });
  const work = await dispatch(fixture.client, policy);
  assert.deepEqual(work, []);
  assert.equal(fixture.assignments.length, 0);
  assert.equal(fixture.claims.size, 0);
  assert.match(renderDispatchResult(work, policy), /No managed implementation tasks.*No agents were started/);
  assert.match(renderDispatchResult(work, policy), /Hosted planning is disabled/);
  assert.match(renderDispatchResult(work, policy), /not an implementation task or execution approval/);
  assert.match(renderDispatchResult(work, config({ planning: { enabled: true, model: "approved-model" } })), /separate Crewbie planning workflow/);
});

test("batch cap, pause and uncertain reservations stop paid assignments without resetting allowances", async () => {
  const f = githubFixture();
  const cfg = config({ execution: { maxLaunchesPerBatch: 1, maxAttemptsPerTask: 3 } });
  const work = await dispatch(f.client, cfg);
  assert.equal(f.assignments.length, 1);
  assert.equal(f.launches.size, 1);
  assert.match(work.find((item) => item.issue.number === 3).reason, /allowance exhausted/);
  await dispatch(f.client, cfg);
  assert.equal(f.assignments.length, 1);
  const paused = githubFixture(); paused.paused = true;
  await runDispatch(paused.client, config(), undefined, undefined, async () => { throw new Error("Should not discover models when paused"); });
  assert.equal(paused.assignments.length, 0);
  const uncertain = githubFixture();
  uncertain.launches.add("refs/tags/crewbie/launches/feature/foundation/1/1");
  const remaining = await dispatch(uncertain.client, config());
  assert.match(remaining[0].reason, /already reserved/);
  assert.ok(!uncertain.claims.has(1));
});

test("read-only preflight shows specialist/model, approval and bounded eligibility without writes", async () => {
  const f = githubFixture();
  const cfg = config({ execution: { maxLaunchesPerBatch: 1, maxAttemptsPerTask: 3 } });
  const client = { ...f.client, async request(method, path, body) {
    assert.ok(method === "GET" || (path === "/graphql" && body.query.startsWith("query")));
    return f.client.request(method, path, body);
  } };
  const result = await preflight(client, cfg, "feature", models);
  assert.equal(result.tasks.filter((item) => item.ready).length, 1);
  assert.equal(result.tasks[0].specialist, "crewbie-developer");
  assert.equal(result.tasks[0].model, "approved-model");
  assert.equal(result.tasks[0].approved, true);
  assert.equal(result.tasks[0].profileRevision, "profile-sha");
  assert.equal(f.assignments.length, 0);
  assert.equal(f.launches.size, 0);
});

test("unavailable account models and unverified legacy histories fail closed before launching", async () => {
  const f = githubFixture();
  await assert.rejects(runDispatch(f.client, config(), undefined, undefined, async () => [{ id: "different", name: "Other" }]), /live account catalog/);
  assert.equal(f.assignments.length, 0);
  assert.equal(f.launches.size, 0);
  f.claims.add(1);
  const work = await dispatch(f.client, config());
  assert.match(work.find((item) => item.issue.number === 3).reason, /pre-ledger claim/);
  assert.equal(f.assignments.length, 0);
});
test("unknown assignment outcome preserves the claim and releases the dispatcher lock", async () => {
  const fixture = githubFixture();
  fixture.failAssignment = true;
  await assert.rejects(dispatch(fixture.client, config()), /persistent launch claim/);
  assert.ok(fixture.claims.has(1));
  assert.equal(fixture.locked, false);
  fixture.failAssignment = false;
  await dispatch(fixture.client, config());
  assert.equal(fixture.assignments.length, 2, "only the other independent issue may launch");
});

test("owner-label tampering cannot redirect an approved task", async () => {
  const fixture = githubFixture();
  fixture.issues[0].labels = ["crewbie:managed", "crewbie:ready", "crewbie:owner:other"];
  const work = await dispatch(fixture.client, config());
  assert.equal(work[0].state, "blocked");
  assert.ok(!fixture.claims.has(1));
});

test("source verification failures block only that launch item and dispatch continues", async () => {
  const fixture = githubFixture();
  const metadata = taskMetadata(fixture.issues[0].body);
  const changed = { ...metadata, sources: [{ uri: "https://github.com/example/project/issues/73", revision: "source-v1" }] };
  fixture.issues[0].body = fixture.issues[0].body.replace(/<!-- crewbie-task:[A-Za-z0-9+/=]+ -->/, `<!-- crewbie-task:${Buffer.from(JSON.stringify(changed)).toString("base64")} -->`);
  fixture.sourceIssue.updated_at = "source-v2";
  const work = await dispatch(fixture.client, config());
  assert.equal(work[0].state, "blocked");
  assert.match(work[0].reason, /Source verification failed: Source changed/);
  assert.ok(!fixture.claims.has(1));
  assert.ok(fixture.claims.has(3), "the independent item still launches");
  assert.equal(fixture.assignments.length, 1);
});

test("a concurrent dispatcher waits for the global capacity lock and never double-launches", async () => {
  const { LOCK_WAIT } = await import("../dist/execution/controls.js");
  const saved = { ...LOCK_WAIT };
  Object.assign(LOCK_WAIT, { attempts: 50, delayMs: 5 });
  const fixture = githubFixture();
  try {
    const results = await Promise.allSettled([dispatch(fixture.client, config()), dispatch(fixture.client, config())]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  } finally { Object.assign(LOCK_WAIT, saved); }
  assert.equal(fixture.assignments.length, 2);
  assert.equal(new Set(fixture.assignments.map((body) => body.agent_assignment.custom_instructions.match(/issue #(\d+)/)[1])).size, 2);
  assert.equal(fixture.locked, false);
});

test("a successful HTTP response with an ignored assignee is not reported as a started session", async () => {
  const fixture = githubFixture();
  fixture.ignoreAssignment = true;
  await assert.rejects(dispatch(fixture.client, config()), /did not confirm Copilot/);
  assert.equal(fixture.assignments.length, 1);
  assert.ok(fixture.claims.has(1));
  assert.equal(fixture.locked, false);
  assert.ok(!fixture.issues[0].labels.includes("crewbie:running"));
});

test("a model the cloud agent rejects blocks only its tasks, before any claim or reservation", async () => {
  const fixture = githubFixture();
  fixture.rejectedModels = ["approved-model"];
  const blocked = await dispatch(fixture.client, config());
  assert.ok(blocked.some((item) => item.state === "blocked" && /cloud agent does not accept model approved-model/.test(item.reason)));
  assert.deepEqual(fixture.modelChecks, ["approved-model"], "Each distinct model is checked once.");
  assert.equal(fixture.assignments.length, 0);
  assert.equal(fixture.claims.size, 0);
  assert.equal(fixture.launches.size, 0);
  assert.equal(fixture.locked, false);
  fixture.rejectedModels = [];
  await dispatch(fixture.client, config());
  assert.ok(fixture.assignments.length > 0);
});

test("a credential that cannot create agent tasks skips the model check instead of blocking dispatch", async () => {
  const fixture = githubFixture();
  fixture.probeStatus = 403;
  await dispatch(fixture.client, config());
  assert.ok(fixture.assignments.length > 0);
});

test("completed cloud sessions free capacity without treating unmerged PRs as completed prerequisites", async () => {
  const fixture = githubFixture();
  await dispatch(fixture.client, config({ maxActive: 1 }));
  fixture.pulls.set(1, { id: 1001, number: 101, draft: true, state: "open", user: { login: "Copilot" } });
  fixture.cloudTasks.push({ id: "task-1", state: "completed", artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
  const work = await dispatch(fixture.client, config({ maxActive: 1 }));
  assert.equal(work.find((item) => item.issue.number === 1).sessionComplete, true);
  assert.equal(work.find((item) => item.issue.number === 1).state, "review");
  assert.equal(work.find((item) => item.issue.number === 2).state, "blocked");
  assert.equal(fixture.assignments.length, 2, "The other independent task may run before the first PR merges.");
  assert.ok(fixture.claims.has(3));
});

test("in a feature plan a review task waits until its prerequisites merged into the feature branch", async () => {
  const input = batch();
  input.tasks[1].kind = "review";
  input.tasks[1].dependsOn = ["foundation"];
  const fixture = githubFixture(input);
  await dispatch(fixture.client, config({ maxActive: 3 }));
  fixture.pulls.set(1, { id: 1001, number: 101, state: "open", user: { login: "Copilot" } });
  fixture.cloudTasks.push({ id: "task-1", state: "completed", artifacts: [{ provider: "github", type: "pull", data: { id: 1001 } }] });
  fixture.checkRuns.push({ id: 1, name: "build", status: "in_progress", conclusion: null, app: { slug: "github-actions" } });
  const work = await dispatch(fixture.client, config({ maxActive: 3 }));
  assert.match(work.find((item) => item.metadata.task.id === "consumer").reason, /^Waiting for foundation to merge into crewbie\/feature-[0-9a-f]{8}\.$/);
  assert.ok(!fixture.claims.has(2));
});
test("scoped dispatch detects remote scope drift before making any paid assignment", async () => {
  const fixture = githubFixture();
  fixture.issues[0].body += "\nRemote scope changed.";
  const approved = approvedBatch(parseBatch(batch(), config()), true);
  await assert.rejects(dispatch(fixture.client, config(), undefined, { batch: approved, issueNumbers: [1, 2, 3] }), /differs/);
  assert.equal(fixture.assignments.length, 0);
  assert.equal(fixture.locked, false);
});

test("fresh publication receipts survive lagging label indexes without bypassing approvals", async () => {
  for (const [scoped, approvedComments] of [[true, true], [true, false], [false, true], [false, false]]) {
    const fixture = githubFixture();
    const original = fixture.client.list;
    fixture.client.list = async (path) => {
      if (path.includes("/issues?")) return [];
      if (!approvedComments && path.endsWith("/comments")) return [];
      return original(path);
    };
    const approved = approvedBatch(parseBatch(batch(), config()), true);
    const action = dispatch(fixture.client, config(), undefined, { ...(scoped ? { batch: approved } : {}), issueNumbers: [1, 2, 3] });
    if (approvedComments || !scoped) {
      await action;
      assert.equal(fixture.assignments.length, approvedComments ? 2 : 0);
    } else {
      await assert.rejects(action, /differs/);
      assert.equal(fixture.assignments.length, 0);
    }
  }
});

test("a draft PR alone, missing telemetry or a resumed session never frees capacity", async () => {
  for (const mode of ["missing", "denied", "active"]) {
    const fixture = githubFixture();
    await dispatch(fixture.client, config({ maxActive: 1 }));
    fixture.pulls.set(1, { id: 1001, number: 101, draft: true, state: "open", user: { login: "Copilot" } });
    fixture.cloudStatusDenied = mode === "denied";
    if (mode === "active") fixture.cloudTasks.push({ id: "task-1", state: "in_progress", artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
    const work = await dispatch(fixture.client, config({ maxActive: 1 }));
    assert.equal(work[0].sessionComplete, false);
    assert.equal(fixture.assignments.length, 1, mode);
    assert.match(work[0].reason, /capacity|active|unverified/i);
  }
});

test("closing completed trial work frees its slot without erasing claims or releasing unmerged dependencies", async () => {
  const fixture = githubFixture();
  await dispatch(fixture.client, config({ maxActive: 1 }));
  fixture.pulls.set(1, { id: 1001, number: 101, state: "closed", merged_at: null, user: { login: "Copilot" } });
  fixture.cloudTasks.push({ id: "finished-task", state: "completed", custom_agent: { id: "crewbie-developer" }, artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
  const work = await dispatch(fixture.client, config({ maxActive: 1 }));
  assert.equal(work[0].pull?.number, 101, "The closing PR is still correlated.");
  assert.equal(fixture.assignments.length, 2, "The independent next task must be able to start after verified completion.");
  assert.equal(work[0].state, "failed", "Closed-unmerged work is not completed implementation.");
  assert.equal(work[0].sessionComplete, true);
  assert.ok(fixture.claims.has(1), "Keep the historical launch claim.");
  assert.ok(!fixture.claims.has(2), "An unmerged prerequisite still blocks its dependent.");
});

test("Copilot start failures free capacity; claims without that evidence stay reserved", async () => {
  for (const verified of [true, false]) {
    const fixture = githubFixture();
    await dispatch(fixture.client, config({ maxActive: 1 }));
    fixture.issues[0].state = "closed";
    fixture.issues[0].assignees = [{ login: "Copilot" }];
    fixture.extraComments[1] = [{ user: verified ? { type: "Bot", login: "Copilot" } : { type: "User", login: "someone" },
      body: "The agent encountered an error and was unable to start working on this issue: Please try again later." }];
    const work = await dispatch(fixture.client, config({ maxActive: 1 }));
    assert.equal(work[0].state, "failed");
    assert.equal(fixture.assignments.length, verified ? 2 : 1, verified ? "A verified start failure frees its slot." : "Human text cannot release capacity.");
    if (verified) assert.match(work[0].reason, /could not start/);
    else assert.match(work[0].reason, /capacity stays reserved/);
    assert.ok(fixture.claims.has(1), "Keep the historical launch claim.");
  }
  const fixture = githubFixture();
  await dispatch(fixture.client, config({ maxActive: 1 }));
  fixture.issues[0].state = "closed";
  fixture.pulls.set(1, { id: 1001, number: 101, state: "closed", merged_at: null, user: { login: "Copilot" } });
  fixture.cloudTasks.push({ id: "cancelled-task", state: "cancelled", artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
  await dispatch(fixture.client, config({ maxActive: 1 }));
  assert.equal(fixture.assignments.length, 2, "Closed work whose native task is verified cancelled frees its slot.");
});

test("closed PRs with active or unverified native sessions keep their capacity reservation", async () => {
  for (const mode of ["active", "missing", "denied", "ambiguous"]) {
    const fixture = githubFixture();
    await dispatch(fixture.client, config({ maxActive: 1 }));
    fixture.issues[0].state = "closed";
    fixture.pulls.set(1, { id: 1001, number: 101, state: "closed", merged_at: null, user: { login: "Copilot" } });
    if (mode === "active") fixture.cloudTasks.push({ id: "active-task", state: "in_progress", artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
    if (mode === "ambiguous") {
      for (const id of ["finished-a", "finished-b"]) fixture.cloudTasks.push({ id, state: "completed", artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
    }
    fixture.cloudStatusDenied = mode === "denied";
    const work = await dispatch(fixture.client, config({ maxActive: 1 }));
    assert.equal(fixture.assignments.length, 1, mode);
    assert.equal(work[0].sessionComplete, false);
    assert.match(work[0].reason, /capacity stays reserved/);
    if (mode === "denied") assert.match(work[0].reason, /HTTP 403/, "Keep the actionable telemetry error visible after closure.");
  }
});

test("terminal cloud failures stop watched work without relaunching or satisfying review prerequisites", async () => {
  for (const state of ["failed", "timed_out", "cancelled"]) {
    const input = batch();
    input.tasks[1].kind = "review";
    const fixture = githubFixture(input);
    await dispatch(fixture.client, config({ maxActive: 1 }));
    fixture.pulls.set(1, { id: 1001, number: 101, state: "open", user: { login: "Copilot" } });
    fixture.cloudTasks.push({ id: "task-1", state, artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
    const approved = approvedBatch(parseBatch(input, config()), true);
    const result = await watchBatch(approved, () => dispatch(fixture.client, config({ maxActive: 1 })), { pollMs: 1 });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.work[0].state, "failed");
    assert.equal(result.work[0].sessionComplete, false);
    assert.equal(result.work[1].state, "blocked");
    assert.equal(fixture.assignments.length, 1);
  }
});

test("review mentions do not become implementation PRs for another issue", async () => {
  const fixture = githubFixture();
  fixture.pulls.set(1, { number: 101, state: "open", user: { login: "Copilot" } });
  fixture.pulls.set(99, { number: 102, state: "open", user: { login: "Copilot" } });
  const original = fixture.client.list;
  fixture.client.list = async (path) => {
    const result = await original(path);
    if (path.endsWith("/issues/1/timeline")) result.push({ event: "cross-referenced", source: { issue: { pull_request: { url: "https://api.github.com/repos/example/project/pulls/102" } } } });
    return result;
  };
  assert.equal((await linkedPull(fixture.client, "example/project", 1)).number, 101);
});

test("closing-reference reads paginate, exclude other repositories and reject partial GraphQL errors", async () => {
  let calls = 0;
  const client = { async request(method, path, body) {
    if (path === "/graphql") {
      calls++;
      const first = body.variables.after === null;
      return { data: { repository: { issue: { closedByPullRequestsReferences: {
        nodes: [{ number: 101, repository: { nameWithOwner: first ? "elsewhere/project" : "Example/Project" } }],
        pageInfo: { hasNextPage: first, endCursor: "next" },
      } } } } };
    }
    assert.equal(path, "/repos/example/project/pulls/101");
    return { number: 101, user: { login: "copilot-swe-agent" } };
  } };
  assert.equal((await linkedPull(client, "example/project", 1)).number, 101);
  assert.equal(calls, 2);
  await assert.rejects(linkedPull({ request: async () => ({ errors: [{ message: "Denied" }], data: {} }) }, "example/project", 1), /could not establish/);
});

test("another task's PR that merely mentions an issue with a closing keyword does not make its link ambiguous", async () => {
  const linked = (prs) => ({ async request(method, path) {
    if (path === "/graphql") return { data: { repository: { issue: { closedByPullRequestsReferences: {
      nodes: prs.map((pr) => ({ number: pr.number, repository: { nameWithOwner: "example/project" } })), pageInfo: { hasNextPage: false, endCursor: null },
    } } } } };
    return prs.find((pr) => path.endsWith(`/pulls/${pr.number}`));
  } });
  const own = { number: 68, state: "closed", merged_at: "2026-09-25T10:48:10Z", title: "Add promo entry", user: { login: "Copilot" } };
  const review = { number: 69, state: "open", merged_at: null, title: "Review promo interaction accessibility (issue #63)", user: { login: "Copilot" } };
  assert.equal((await linkedPull(linked([own, review]), "example/project", 61)).number, 68);
  assert.equal((await linkedPull(linked([{ ...own, merged_at: "2026-09-26T00:00:00Z" }, { ...review, merged_at: "2026-09-25T11:00:00Z", state: "closed" }]), "example/project", 61)).number, 69);
  const open = { ...own, state: "open", merged_at: null, title: "Integrate promo entry (issue #61)" };
  assert.equal((await linkedPull(linked([open, review]), "example/project", 61)).number, 68);
  await assert.rejects(linkedPull(linked([{ ...open, title: "Promo" }, review]), "example/project", 61), /multiple candidate agent PRs/);
});

test("dispatch lock waits for a concurrent holder and reports a stuck lock", async () => {
  const { withDispatchLock, LOCK_WAIT } = await import("../dist/execution/controls.js");
  const saved = { ...LOCK_WAIT };
  Object.assign(LOCK_WAIT, { attempts: 3, delayMs: 1 });
  let busy = 2, held = false;
  const client = {
    async request(method, path, body) {
      if (path === "/repos/example/project") return { default_branch: "main" };
      if (path.endsWith("/branches/main")) return { commit: { sha: "base-sha" } };
      if (method === "POST" && body?.ref === "refs/tags/crewbie/dispatch-lock") {
        if (busy-- > 0) throw new GitHubError(422, "locked");
        held = true; return {};
      }
      if (method === "DELETE" && path.endsWith("/dispatch-lock")) { held = false; return null; }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  try {
    assert.equal(await withDispatchLock(client, config(), async () => { assert.equal(held, true); return "ran"; }), "ran");
    assert.equal(held, false);
    busy = 10;
    await assert.rejects(withDispatchLock(client, config(), async () => "never"), /still holds refs\/tags\/crewbie\/dispatch-lock/);
  } finally { Object.assign(LOCK_WAIT, saved); }
});

test("a replanned batch launches its new issue despite a superseded closed issue for the same task", async () => {
  const revisedInput = batch();
  for (const task of revisedInput.tasks) task.body = `${task.body}\nRevised plan.`;
  const fixture = githubFixture(revisedInput);
  const old = parseBatch(batch(), config());
  const task = old.tasks[0];
  fixture.issues.push({ number: 99, state: "closed", title: task.title, body: issueBody(old, task), labels: ["crewbie:managed", "crewbie:failed", `crewbie:owner:${task.owner}`] });
  fixture.launches.add(`refs/tags/crewbie/launches/${old.id}/${task.id}/99/1`);
  await dispatch(fixture.client, config());
  const launched = fixture.assignments.map((body) => Number(body.agent_assignment.custom_instructions.match(/issue #(\d+)/)[1]));
  assert.ok(launched.includes(1), `revised task issue #1 should launch; launched ${launched}`);
  assert.ok(!launched.includes(99));
});

const HEAD = "a".repeat(40), HEAD2 = "b".repeat(40);
const reviewing = (overrides = {}) => config({ maxActive: 2, review: { enabled: true, role: "developer" }, merge: { method: "squash" }, ...overrides });
function finishedPull(fixture) {
  fixture.pulls.set(1, { id: 1001, node_id: "PR_1", number: 101, draft: true, state: "open", mergeable: true, labels: [],
    head: { sha: HEAD, ref: "copilot/foundation" }, user: { login: "Copilot" } });
  fixture.cloudTasks.push({ id: "task-1", state: "completed", artifacts: [{ type: "pull", provider: "github", data: { id: 1001 } }] });
}
function reviewRun(fixture, id, head = HEAD, overrides = {}) {
  fixture.reviewRuns.push({ id, display_title: `Crewbie review PR #101 at ${head}`, status: "completed", conclusion: "success", html_url: `https://run/${id}`,
    path: ".github/workflows/crewbie-review.yml", event: "workflow_dispatch", head_branch: "main", head_repository: { full_name: "example/project" },
    actor: { type: "User", login: "maintainer" }, triggering_actor: { type: "User", login: "maintainer" }, ...overrides });
}
function reviewComment(fixture, cfg, runId, findings, { head = HEAD, login = "github-actions[bot]" } = {}) {
  const review = parseReview(JSON.stringify({ verdict: findings.length ? "changes" : "pass", summary: "Grumpy but fair.", findings }));
  const body = renderReview(cfg, { schemaVersion: 1, pr: 101, head, feature: { batch: "feature", branch: BRANCH }, role: "developer", runId, omitted: [] }, review);
  (fixture.prComments[101] ??= []).push({ user: { type: "Bot", login }, created_at: `r${runId}`, updated_at: `r${runId}`, body, html_url: "https://comment" });
}

test("a finished task PR of a feature plan merges into the feature branch once every check passes, without a review", async () => {
  const cfg = reviewing({ maxActive: 1 });
  const fixture = githubFixture();
  await dispatch(fixture.client, cfg);
  assert.equal(fixture.assignments[0].agent_assignment.base_branch, BRANCH, "Tasks launch from the plan's feature branch.");
  assert.ok(fixture.branches.has(BRANCH), "The first launch creates the feature branch.");
  finishedPull(fixture);
  fixture.pulls.get(1).requested_reviewers = [{ login: "maintainer", type: "User" }];
  fixture.checkRuns.push({ id: 4, name: "build", status: "in_progress", conclusion: null, app: { slug: "github-actions" } });
  let work = await dispatch(fixture.client, cfg);
  assert.deepEqual(fixture.readied, [101]);
  assert.deepEqual(fixture.withdrawn, ["maintainer"], "Copilot's review request on a task PR is withdrawn; only the feature PR asks for a person.");
  assert.match(work[0].reason, /Session completed on aaaaaaa\. Waiting for check build/);
  assert.equal(fixture.merges.length, 0);
  fixture.checkRuns[0] = { ...fixture.checkRuns[0], status: "completed", conclusion: "success" };
  fixture.checkRuns.push({ id: 5, name: "ci", status: "completed", conclusion: "action_required", app: { slug: "github-actions" } });
  work = await dispatch(fixture.client, cfg);
  assert.deepEqual(fixture.merges, [{ number: 101, sha: HEAD, merge_method: "squash" }]);
  assert.equal(work[0].state, "done");
  assert.match(work[0].reason, /into crewbie\/feature-[0-9a-f]{8}/);
  assert.equal(fixture.reviewRequests.length, 0, "Task PRs are not reviewed.");
  assert.equal(fixture.featurePulls.length, 0, "The feature PR waits for every task.");
  assert.equal(work.find((item) => item.issue.number === 2).reason, `Waiting for foundation to merge into ${BRANCH}.`);
});
test("the feature PR also closes the PRD issue the plan came from", async () => {
  const input = { ...batch(), sources: [{ uri: "https://github.com/example/project/issues/73", revision: "r1" }] };
  const fixture = githubFixture(input);
  fixture.branches.add(featureBranch(parseBatch(input, config())));
  for (const issue of [1, 2, 3]) {
    fixture.claims.add(issue);
    fixture.pulls.set(issue, { id: 1000 + issue, number: 100 + issue, state: "closed", merged_at: "then", user: { login: "Copilot" } });
  }
  fixture.events[73] = [
    { event: "labeled", label: { name: "crewbie:ready-for-planning" }, actor: { type: "User", login: "reader" } },
    { event: "labeled", label: { name: "crewbie:ready-for-planning" }, actor: { type: "User", login: "maintainer" } },
  ];
  const work = await dispatch(fixture.client, config());
  assert.match(fixture.featurePulls[0].body, /Closes #3\nCloses #73\n/);
  assert.deepEqual(fixture.requested, [{ path: "/repos/example/project/pulls/900/requested_reviewers", reviewers: ["maintainer"] }], "Whoever last labeled the PRD for planning is asked to review its feature PR.");
  assert.match(work[0].reason, /Requested review from @maintainer\./);
});
test("once every task merged, one feature PR closes them all; the reviewer reviews each head and only a human merges it", async () => {
  const cfg = reviewing();
  const fixture = githubFixture();
  fixture.branches.add(BRANCH);
  for (const issue of [1, 2, 3]) {
    fixture.claims.add(issue);
    fixture.pulls.set(issue, { id: 1000 + issue, number: 100 + issue, state: "closed", merged_at: "then", user: { login: "Copilot" } });
  }
  let work = await dispatch(fixture.client, cfg);
  assert.equal(fixture.featurePulls.length, 1);
  const [feature] = fixture.featurePulls;
  assert.deepEqual([feature.head.ref, feature.base.ref], [BRANCH, "main"]);
  assert.match(feature.body, /Closes #1\nCloses #2\nCloses #3/);
  assert.match(feature.body, /merge this PR yourself; Crewbie never merges it/);
  assert.deepEqual(fixture.reviewRequests, [{ ref: "main", inputs: { pr: "900", head: "feature-0" } }]);
  assert.match(work[0].reason, /Merged into crewbie\/feature-[0-9a-f]{8}\. Opened feature PR #900\. Requested a Crewbie review/);
  fixture.reviewRuns.push({ id: 20, display_title: "Crewbie review PR #900 at feature-0", status: "in_progress", conclusion: null });
  work = await dispatch(fixture.client, cfg);
  assert.equal(fixture.featurePulls.length, 1, "The feature PR is opened once.");
  assert.equal(fixture.reviewRequests.length, 1, "One review per feature head.");
  assert.match(work[0].reason, /is reviewing feature/);
  feature.merged_at = "later"; feature.state = "closed";
  work = await dispatch(fixture.client, cfg);
  assert.match(work[0].reason, /Feature PR #900 merged into main/);
  assert.equal(fixture.merges.length, 0, "Crewbie never merges the feature PR.");
});

test("feature PR body updates only managed task closes and preserves human edits", async () => {
  const fixture = githubFixture();
  fixture.branches.add(BRANCH);
  for (const issue of [1, 2, 3]) {
    fixture.claims.add(issue);
    fixture.pulls.set(issue, { id: 1000 + issue, number: 100 + issue, state: "closed", merged_at: "then", user: { login: "Copilot" } });
  }
  await dispatch(fixture.client, config());
  const feature = fixture.featurePulls[0];
  feature.body = `Human intro.\n\n${feature.body}\n\nHuman footer.`;
  const base = parseBatch(batch(), config());
  const fix = { ...task("fix-1-developer"), title: "Address Crewbie review fixes for developer" };
  fixture.issues.push({
    number: 4, state: "open", title: fix.title,
    body: issueBody(approvedBatch({ ...base, tasks: [fix] }, true), fix, { batchDigest: batchDigest(base), branch: BRANCH }),
    labels: ["crewbie:managed", "crewbie:done", "crewbie:owner:developer"],
  });
  fixture.claims.add(4);
  fixture.pulls.set(4, { id: 1004, number: 104, state: "closed", merged_at: "then", user: { login: "Copilot" } });
  await dispatch(fixture.client, config());
  assert.equal(fixture.prPatches.length, 1);
  assert.match(feature.body, /^Human intro\./);
  assert.match(feature.body, /Human footer\./);
  assert.match(feature.body, /Closes #4/);
  await dispatch(fixture.client, config());
  assert.equal(fixture.prPatches.length, 1, "unchanged task issue set is not rewritten");
});
test("a plan still in progress opens no feature PR, and a closed feature PR is not reopened", async () => {
  const fixture = githubFixture();
  fixture.branches.add(BRANCH);
  for (const issue of [1, 2, 3]) {
    fixture.claims.add(issue);
    fixture.pulls.set(issue, { id: 1000 + issue, number: 100 + issue, state: "closed", merged_at: issue === 3 ? null : "then", user: { login: "Copilot" } });
  }
  fixture.pulls.get(3).state = "open";
  await dispatch(fixture.client, config());
  assert.equal(fixture.featurePulls.length, 0);
  fixture.pulls.get(3).merged_at = "then";
  fixture.featurePulls.push({ number: 800, state: "closed", merged_at: null, head: { ref: BRANCH, sha: "x" }, base: { ref: "main" } });
  const work = await dispatch(fixture.client, config());
  assert.equal(fixture.featurePulls.length, 1);
  assert.match(work[0].reason, /Feature PR #800 was closed without merging/);
});
test("feature-PR reviews are trusted only from the default-branch workflow, and a failed reviewer is never retried", async () => {
  const cfg = reviewing();
  const fixture = githubFixture();
  fixture.branches.add(BRANCH);
  for (const issue of [1, 2, 3]) {
    fixture.claims.add(issue);
    fixture.pulls.set(issue, { id: 1000 + issue, number: 100 + issue, state: "closed", merged_at: "then", user: { login: "Copilot" } });
  }
  fixture.featurePulls.push({ number: 101, state: "open", merged_at: null, head: { ref: BRANCH, sha: HEAD }, base: { ref: "main" } });
  let work = await dispatch(fixture.client, cfg);
  assert.deepEqual(fixture.reviewRequests, [{ ref: "main", inputs: { pr: "101", head: HEAD } }]);
  reviewRun(fixture, 7, HEAD, { status: "in_progress", conclusion: null });
  work = await dispatch(fixture.client, cfg);
  assert.match(work[0].reason, /reviewing aaaaaaa/);
  assert.equal(fixture.reviewRequests.length, 1, "One review run per head.");
  fixture.reviewRuns[0] = { ...fixture.reviewRuns[0], status: "completed", conclusion: "failure" };
  work = await dispatch(fixture.client, cfg);
  assert.match(work[0].reason, /ended failure[\s\S]*does not retry/);
  assert.equal(fixture.reviewRequests.length, 1, "A failed reviewer is reported, never retried automatically.");
  reviewComment(fixture, cfg, 7, [], { login: "someone" });
  reviewRun(fixture, 8, HEAD, { head_branch: "copilot/foundation" });
  reviewComment(fixture, cfg, 8, []);
  work = await dispatch(fixture.client, cfg);
  assert.match(work[0].reason, /without a verdict comment/, "Forged comments and runs outside the default-branch workflow are not trusted.");
  reviewRun(fixture, 9);
  reviewComment(fixture, cfg, 9, [{ severity: "blocking", path: "src/a.ts", line: 3, body: "Null input crashes." }]);
  work = await dispatch(fixture.client, cfg);
  assert.match(work[0].reason, /requested changes on aaaaaaa; push fixes to crewbie\/feature-[0-9a-f]{8}/);
  reviewRun(fixture, 10);
  reviewComment(fixture, cfg, 10, [{ severity: "minor", path: "src/a.ts", line: 4, body: "Rename x." }]);
  work = await dispatch(fixture.client, cfg);
  assert.match(work[0].reason, /found no blocking issues on aaaaaaa\. Test crewbie\/feature-[0-9a-f]{8}, then merge feature PR #101 yourself/);
  assert.equal(fixture.merges.length, 0);
});
test("pre-feature-branch task issues are left to people: dispatch neither launches, reviews nor counts them", async () => {
  const fixture = githubFixture();
  const b = parseBatch(batch(), config());
  const legacy = JSON.parse(Buffer.from(/crewbie-task:([A-Za-z0-9+/=]+)/.exec(fixture.issues[0].body)[1], "base64").toString());
  delete legacy.branch;
  for (const issue of fixture.issues) issue.body = issue.body.replace(/crewbie-task:[A-Za-z0-9+/=]+/, `crewbie-task:${Buffer.from(JSON.stringify({ ...legacy, task: b.tasks[issue.number - 1] })).toString("base64")}`);
  const work = await dispatch(fixture.client, config({ maxActive: 3 }));
  assert.deepEqual(work, []);
  assert.equal(fixture.assignments.length, 0);
});

test("auto-merge reads checks with the job's checks token, so the user credential needs no Checks access", async () => {
  const { autoMerge, CHECK_READER } = await import("../dist/execution/merge.js");
  const merges = [];
  let files = [];
  const user = { async list(path) { assert.match(path, /\/pulls\/101\/files$/); return files; }, async request(method, path, body) {
    if (path.includes("/check-runs") || path.endsWith("/status")) throw new GitHubError(403, "Resource not accessible by personal access token");
    if (method === "GET" && path.endsWith("/pulls/101")) return { state: "open", draft: false, mergeable: true, head: { sha: HEAD }, base: { ref: BRANCH } };
    if (method === "PUT" && path.endsWith("/pulls/101/merge")) { merges.push(body); return { merged: true }; }
    throw new Error(`Unexpected ${method} ${path}`);
  } };
  const reads = [];
  CHECK_READER.client = { async request(method, path) {
    reads.push(path);
    return path.includes("/check-runs") ? { total_count: 1, check_runs: [{ id: 1, name: "build", status: "completed", conclusion: "success", app: { slug: "github-actions" } }] } : { statuses: [] };
  } };
  try {
    const outcome = await autoMerge(user, config({ merge: { method: "squash" } }), 101, HEAD);
    assert.equal(outcome.merged, true, outcome.reason);
    assert.deepEqual(merges, [{ sha: HEAD, merge_method: "squash" }]);
    assert.equal(reads.length, 2);
    assert.match(outcome.reason, /every check passed/);
    CHECK_READER.client = { async request(method, path) { return path.includes("/check-runs") ? { total_count: 0, check_runs: [] } : { statuses: [] }; } };
    const bare = await autoMerge(user, config(), 101, HEAD);
    assert.equal(bare.merged, true, "A repository without CI still gets its task PRs merged into the feature branch.");
    assert.match(bare.reason, /no checks ran on it; the feature PR is where it gets tested/);
    files = [{ filename: ".github/workflows/ci.yml" }];
    const guarded = await autoMerge(user, config(), 101, HEAD);
    assert.equal(guarded.merged, false);
    assert.match(guarded.reason, /changes \.github\/workflows\/ci\.yml; review and merge it yourself/);
    assert.equal(merges.length, 2, "Workflow changes are never auto-merged: they run with secrets on the feature branch.");
  } finally { delete CHECK_READER.client; }
});

test("dispatch reads closed issues only for prerequisites of open work", async () => {
  const fixture = githubFixture();
  const old = parseBatch({ ...batch(), id: "finished" }, config());
  fixture.issues.push({ number: 50, state: "closed", title: old.tasks[0].title, body: issueBody(old, old.tasks[0]), labels: ["crewbie:managed", "crewbie:done", "crewbie:owner:developer"], updated_at: "2020-01-01T00:00:00.000Z" });
  fixture.claims.add(50);
  const lists = [];
  const list = fixture.client.list.bind(fixture.client);
  fixture.client.list = (path) => { lists.push(path); return list(path); };
  const work = await dispatch(fixture.client, config());
  assert.ok(!work.some((item) => item.issue.number === 50));
  assert.ok(!lists.some((path) => path.includes("/issues/50/") || (path.includes("state=closed") && !path.includes("since=")) || path.includes("state=all")), lists.join("\n"));
});

test("an open task whose prerequisite closed long ago launches once that prerequisite's PR merged", async () => {
  for (const merged of [true, false]) {
    const fixture = githubFixture();
    Object.assign(fixture.issues[0], { state: "closed", updated_at: "2020-01-01T00:00:00.000Z" });
    fixture.pulls.set(1, { id: 1001, number: 101, state: "closed", merged_at: merged ? "then" : null, user: { login: "Copilot" } });
    const work = await dispatch(fixture.client, config({ maxActive: 3 }));
    const consumer = work.find((item) => item.metadata.task.id === "consumer");
    assert.equal(consumer.state, merged ? "running" : "blocked", String(merged));
    assert.equal(work.find((item) => item.issue.number === 1).state, merged ? "done" : "failed");
  }
});

test("a write-access user's restart label relaunches a verified non-start as a counted attempt; other requests are refused", async () => {
  const fixture = githubFixture();
  await dispatch(fixture.client, config());
  const launchesFor = (issue) => fixture.assignments.filter((body) => body.agent_assignment.custom_instructions.startsWith(`Implement only issue #${issue}.`)).length;
  fixture.issues[0].assignees = [{ login: "Copilot" }];
  fixture.extraComments[1] = [{ user: { type: "Bot", login: "Copilot" }, body: "The agent encountered an error and was unable to start working on this issue." }];
  const request = (issue, login) => {
    fixture.issues[issue - 1].labels.push("crewbie:restart");
    (fixture.events[issue] ??= []).push({ event: "labeled", label: { name: "crewbie:restart" }, actor: { type: "User", login } });
  };
  request(1, "someone");
  await dispatch(fixture.client, config());
  assert.equal(launchesFor(1), 1);
  assert.ok(!fixture.issues[0].labels.includes("crewbie:restart"), "A refused request is consumed.");
  assert.match(fixture.posted.at(-1).comment.body, /write access/);
  request(3, "maintainer");
  await dispatch(fixture.client, config());
  assert.equal(launchesFor(3), 1, "A running session is never relaunched.");
  assert.match(fixture.posted.at(-1).comment.body, /not verified as ended/);
  request(1, "maintainer");
  const work = await dispatch(fixture.client, config());
  assert.equal(launchesFor(1), 2);
  assert.deepEqual(fixture.unassigned, [{ assignees: ["copilot-swe-agent[bot]"] }]);
  assert.match(fixture.posted.at(-1).comment.body, /attempt 1 of 3[\s\S]*<!-- crewbie-restart:/);
  assert.ok(!fixture.issues[0].labels.includes("crewbie:restart"));
  assert.equal(work[0].state, "running");
  assert.equal([...fixture.launches].filter((ref) => ref.includes("/foundation/1/")).length, 2, "The restart reserves a new ledger entry.");
  assert.equal((await dispatch(fixture.client, config()))[0].state, "running", "The old start failure no longer describes the relaunched session.");
  assert.equal(launchesFor(1), 2);
});