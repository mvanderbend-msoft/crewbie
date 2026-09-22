import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, linkedPull } from "../dist/execution/dispatch.js";
import { GitHubError } from "../dist/execution/github.js";
import { approvedBatch, issueBody, issueDigest, parseBatch } from "../dist/specification/batch.js";
import { watchBatch } from "../dist/execution/watch.js";
import { approvalComment } from "../dist/tracking/issues.js";
import { config, batch } from "./helpers.mjs";

function githubFixture(input = batch()) {
  const b = parseBatch(input, config());
  const issues = b.tasks.map((task, index) => ({
    number: index + 1, state: "open", title: task.title, body: issueBody(b, task),
    labels: ["crewbie:managed", "crewbie:blocked", "crewbie:owner:developer"],
  }));
  const claims = new Set(), pulls = new Map(), assignments = [];
  let locked = false;
  const fixture = {
    issues, claims, pulls, assignments, cloudTasks: [], cloudStatusDenied: false, failAssignment: false, ignoreAssignment: false,
    get locked() { return locked; },
    client: {
      async list(path) {
        if (path.endsWith("/labels")) return ["managed", "blocked", "ready", "running", "review", "failed", "done", "owner:developer"].map((name) => ({ name: `crewbie:${name}` }));
        if (path.includes("/issues?")) return structuredClone(issues);
        const match = /\/issues\/(\d+)\/(comments|timeline)$/.exec(path);
        if (match) {
          const issue = issues.find((item) => item.number === Number(match[1]));
          if (match[2] === "comments") return [{
            user: { type: "User", login: "maintainer" }, created_at: "same", updated_at: "same",
            body: approvalComment(issueDigest(issue.title, issue.body), true),
          }];
          const pr = pulls.get(issue.number);
          return pr ? [{ event: "cross-referenced", source: { issue: { pull_request: { url: `https://api.github.com/repos/example/project/pulls/${pr.number}` } } } }] : [];
        }
        throw new Error(`Unexpected list: ${path}`);
      },
      async request(method, path, body) {
        if (path === "/graphql") {
          const pr = pulls.get(body.variables.number);
          return { data: { repository: { issue: { closedByPullRequestsReferences: {
            nodes: pr ? [{ number: pr.number, repository: { nameWithOwner: "example/project" } }] : [],
            pageInfo: { hasNextPage: false, endCursor: null },
          } } } } };
        }
        if (path.startsWith("/agents/repos/example/project/tasks?")) {
          if (fixture.cloudStatusDenied) throw new GitHubError(403, "status-denied");
          return { tasks: fixture.cloudTasks };
        }
        if (path === "/repos/example/project") return { default_branch: "main" };
        if (path.endsWith("/branches/main")) return { commit: { sha: "base-sha" } };
        if (path.endsWith("/git/matching-refs/tags/crewbie/claims/")) return [...claims].map((number) => ({ ref: `refs/tags/crewbie/claims/${number}` }));
        if (path.includes("/contents/.github/agents/")) return { sha: "profile-sha", type: "file" };
        if (path.includes("/git/ref/tags/crewbie/claims/")) {
          if (!claims.has(Number(path.split("/").at(-1)))) throw new GitHubError(404, null);
          return {};
        }
        if (method === "POST" && path.endsWith("/git/refs")) {
          if (body.ref.endsWith("/dispatch-lock")) {
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
        if (match) {
          const issue = issues.find((item) => item.number === Number(match[1]));
          if (!match[2]) return structuredClone(issue);
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
        if (pr) return [...pulls.values()].find((item) => item.number === Number(pr[1]));
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

test("a concurrent dispatcher cannot acquire the same global capacity lock", async () => {
  const fixture = githubFixture();
  const results = await Promise.allSettled([dispatch(fixture.client, config()), dispatch(fixture.client, config())]);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(fixture.assignments.length, 2);
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

test("a single watched dispatch releases review tasks automatically and never duplicates launches", async () => {
  const input = batch();
  input.tasks[1].kind = "review";
  input.tasks[1].dependsOn = ["foundation", "independent"];
  const approved = approvedBatch(parseBatch(input, config()), true);
  const fixture = githubFixture(input);
  const counts = [];
  const result = await watchBatch(approved, async () => {
    const work = await dispatch(fixture.client, config(), undefined, { batch: approved, issueNumbers: [1, 2, 3] });
    counts.push(fixture.assignments.length);
    for (const issue of fixture.claims) {
      fixture.pulls.set(issue, { id: 1000 + issue, number: 100 + issue, state: "open", user: { login: "Copilot" } });
      if (!fixture.cloudTasks.some((task) => task.id === `task-${issue}`)) {
        fixture.cloudTasks.push({ id: `task-${issue}`, state: "completed", artifacts: [{ provider: "github", type: "pull", data: { id: 1000 + issue } }] });
      }
    }
    return work;
  }, { pollMs: 1 });
  assert.equal(result.outcome, "handoff");
  assert.deepEqual(counts, [2, 3, 3]);
  assert.equal(fixture.claims.size, 3);
  assert.ok([...fixture.pulls.values()].every((pr) => !pr.merged_at));
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
