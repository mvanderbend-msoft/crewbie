import test from "node:test";
import assert from "node:assert/strict";
import { approvedBatch, batchDigest, parseBatch, requireApproval, issueBody, issueDigest, taskMetadata } from "../dist/specification/batch.js";
import { eligible } from "../dist/execution/dispatch.js";
import { approvalComment, approvedIn, hasApproval, publish, publishDescription, reapproveIssues, setStatus } from "../dist/tracking/issues.js";
import { GitHubError } from "../dist/core.js";
import { hash } from "../dist/core.js";
import { api, isWriter, requireWriter } from "../dist/tracking/github.js";
import { checkPrDescription } from "../dist/specification/prose.js";
import { batch, config, task, work } from "./helpers.mjs";

test("batch validation checks owner/model, acceptance criteria, cycles and missing prerequisites", () => {
  assert.equal(parseBatch(batch(), config()).tasks.length, 3);
  for (const tasks of [[task("a", ["missing"])], [task("a", ["b"]), task("b", ["a"])], [task("a"), task("a")]]) {
    assert.throws(() => parseBatch({ ...batch(), tasks }, config()));
  }
  assert.throws(() => parseBatch({ ...batch(), tasks: [{ ...task("a"), model: "unapproved" }] }, config()), /owner\/model/);
  assert.throws(() => parseBatch({ ...batch(), tasks: [{ ...task("a"), body: "No criteria" }] }), /Acceptance criteria/);
});

test("approval is bound to all substantive task and source data", () => {
  const approved = approvedBatch(parseBatch(batch()), true);
  requireApproval(approved);
  for (const changed of [
    { ...approved, spec: "Different" },
    { ...approved, sources: [{ uri: "requirements.md", revision: "new" }] },
    { ...approved, tasks: [{ ...approved.tasks[0], model: "different" }, ...approved.tasks.slice(1)] },
  ]) assert.throws(() => requireApproval(changed), /changed after approval/);
  assert.equal(batchDigest(approved), batchDigest({ ...approved, approval: null }));
});

test("issue metadata survives prose and round-trips the approved graph", () => {
  const b = parseBatch(batch());
  const body = issueBody(b, b.tasks[1]);
  assert.deepEqual(taskMetadata(body).task.dependsOn, ["foundation"]);
  assert.throws(() => taskMetadata(`${body}\n${body}`), /ambiguous/);
});

test("closed is not done: prerequisites release only after verified merge", () => {
  const failed = [work("a", { state: "failed", claimed: true }), work("b", { dependencies: ["a"] }), work("c")];
  assert.deepEqual(eligible(failed, 2).map((item) => item.metadata.task.id), ["c"]);
  const merged = [work("a", { state: "done", claimed: true }), work("b", { dependencies: ["a"] })];
  assert.deepEqual(eligible(merged, 2).map((item) => item.metadata.task.id), ["b"]);
});

test("review tasks, like implementation, wait until their prerequisites merged into the feature branch", () => {
  const finished = { ...work("a", { state: "review", claimed: true }), sessionComplete: true };
  const review = work("b", { dependencies: ["a"] });
  review.metadata.task.kind = "review";
  const implement = work("c", { dependencies: ["a"] });
  assert.deepEqual(eligible([finished, review, implement], 2), []);
  assert.equal(review.reason, "Waiting for a to merge into crewbie/feature.");
  const merged = work("b", { dependencies: ["a"] });
  merged.metadata.task.kind = "review";
  assert.deepEqual(eligible([{ ...finished, state: "done" }, merged], 2).map((item) => item.metadata.task.id), ["b"]);
  const b = parseBatch({ ...batch(), tasks: [{ ...task("inspect"), kind: "review" }] }, config());
  assert.equal(taskMetadata(issueBody(b, b.tasks[0])).task.kind, "review");
  assert.throws(() => parseBatch({ ...batch(), tasks: [{ ...task("inspect"), kind: "bypass" }] }), /kind/);
});

test("consecutive status changes in one run never remove a label twice, and an already-removed label is fine", async () => {
  const calls = [];
  const client = { async request(method, path) { calls.push(`${method} ${decodeURIComponent(path.split("/labels")[1] ?? "")}`); if (method === "DELETE" && path.endsWith("crewbie%3Ablocked")) throw new GitHubError(404, null); return {}; } };
  const issue = { number: 75, labels: [{ name: "crewbie:managed" }, { name: "crewbie:running" }, { name: "crewbie:blocked" }] };
  await setStatus(client, "example/project", issue, "review");
  await setStatus(client, "example/project", issue, "done");
  assert.deepEqual(calls, ["POST ", "DELETE /crewbie:running", "DELETE /crewbie:blocked", "POST ", "DELETE /crewbie:review"]);
  assert.deepEqual(issue.labels, ["crewbie:managed", "crewbie:done"]);
});

test("ready labels cannot bypass approval, capacity or explicit dependencies", () => {
  const items = [work("a", { state: "running", claimed: true }), work("b"), work("c", { priority: 0 }), work("d", { approved: false })];
  assert.deepEqual(eligible(items, 2).map((item) => item.metadata.task.id), ["c"]);
  assert.deepEqual(eligible([work("a", { state: "blocked", claimed: true }), work("b")], 1), []);
  assert.throws(() => eligible([work("b", { dependencies: ["missing"] })], 2), /Missing prerequisite/);
});

test("closed unexecuted work remains terminal while its prerequisite is unmerged", () => {
  const parent = { ...work("a", { state: "review", claimed: true }), sessionComplete: true };
  const closed = work("b", { state: "failed", dependencies: ["a"] });
  assert.deepEqual(eligible([parent, closed], 2), []);
  assert.equal(closed.state, "failed");
});

test("approval comments require trusted human authors and unchanged exact content", async () => {
  const issue = { number: 1, title: "Task", body: "Approved content" };
  const body = approvalComment(issueDigest(issue.title, issue.body), true);
  const comment = { body, user: { type: "User", login: "maintainer" }, created_at: "same", updated_at: "same" };
  const client = {
    list: async () => [comment],
    request: async (_method, path) => ({ permission: path.includes("/maintainer/") ? "write" : "read" }),
  };
  assert.equal(await hasApproval(client, config(), issue), true);
  assert.equal(await hasApproval(client, config(), { ...issue, body: "Tampered" }), false);
  comment.user.login = "untrusted";
  assert.equal(await hasApproval(client, config(), issue), false);
  comment.user.login = "maintainer"; comment.updated_at = "edited";
  assert.equal(await hasApproval(client, config(), issue), false);
  comment.user = null;
  assert.equal(await hasApproval(client, config(), issue), false, "deleted accounts cannot authorize work or break reconciliation");
});

test("repository write permission authorizes humans but not read-only users or bots", async () => {
  const calls = [];
  const client = {
    async request(method, path) {
      calls.push(`${method} ${path}`);
      if (path === "/user") return { type: "User", login: "maintainer" };
      const login = decodeURIComponent(path.split("/collaborators/")[1].split("/")[0]);
      return { permission: login === "maintainer" ? "write" : login === "admin" ? "admin" : login === "triager" ? "triage" : "read", role_name: login === "custom" ? "maintain" : undefined };
    },
  };
  assert.equal(await isWriter(client, "example/project", { type: "User", login: "maintainer" }), true);
  assert.equal(await isWriter(client, "example/project", { type: "User", login: "reader" }), false);
  assert.equal(await isWriter(client, "example/project", { type: "User", login: "triager" }), false);
  assert.equal(await isWriter(client, "example/project", { type: "Bot", login: "maintainer" }), false);
  assert.equal(await isWriter(client, "example/project", { type: "User", login: "custom" }), true);
  assert.equal(await requireWriter(client, "example/project"), "maintainer");
  await isWriter(client, "example/project", { type: "User", login: "maintainer" });
  assert.equal(calls.filter((call) => call.includes("/collaborators/maintainer/permission")).length, 1, "permission checks are cached per client/repository/login");
});

test("publication retries reuse issues and approvals; bot labels get an explicit dispatch", async () => {
  const issues = [], comments = new Map(), requests = [];
  const client = {
    async list(path) {
      if (path.endsWith("/labels")) return [];
      if (path.includes("/issues?")) return issues;
      if (path.endsWith("/comments")) return comments.get(path) ?? [];
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      requests.push({ method, path, body });
      if (path === "/user") return { login: "maintainer", type: "User" };
      if (path.includes("/collaborators/")) return { permission: "write" };
      if (path.endsWith("/labels")) return body;
      if (path.endsWith("/dispatches")) return null;
      if (method === "GET" && path === "/repos/example/project") return { default_branch: "main" };
      if (path.endsWith("/comments")) {
        comments.set(path, [...(comments.get(path) ?? []), { ...body, user: { type: "User", login: "maintainer" }, created_at: "same", updated_at: "same" }]);
        return {};
      }
      if (path.endsWith("/issues")) {
        const issue = { ...body, number: issues.length + 1, state: "open" };
        issues.push(issue);
        return issue;
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    },
  };
  const approved = approvedBatch(parseBatch(batch(), config()), true);
  await publish(client, config(), approved);
  assert.equal(issues.length, 3);
  await publish(client, config(), approved);
  assert.equal(issues.length, 3);
  assert.equal([...comments.values()].flat().length, 3);
  assert.equal(requests.filter((request) => request.path.endsWith("/dispatches")).length, 2);
  await publish(client, config(), approved, undefined, false);
  assert.equal(requests.filter((request) => request.path.endsWith("/dispatches")).length, 2, "Local dispatch retains approvals without starting a second Actions dispatcher.");
  assert.equal([...comments.values()].flat().length, 3);

  const revisedInput = batch();
  revisedInput.tasks[0].body = `${revisedInput.tasks[0].body}\nRevised by a later approved plan.`;
  const revised = approvedBatch(parseBatch(revisedInput, config()), true);
  issues[0].state = "open";
  await assert.rejects(publish(client, config(), revised, undefined, false), /differs from the approved batch/, "open earlier revisions still require reconciliation");
  for (const issue of issues) issue.state = "closed";
  const mappings = await publish(client, config(), revised, undefined, false);
  assert.equal(issues.length, 6, "closed issues from a superseded revision are not reused or overwritten");
  assert.deepEqual(mappings.map((item) => item.issue), [4, 5, 6]);
});

test("GitHub writer fails closed and paginates without dropping records", async () => {
  let calls = 0;
  const client = api("test", async (url) => {
    calls++;
    return new Response(JSON.stringify(new URL(url).searchParams.get("page") === "1" ? Array.from({ length: 100 }, (_, i) => ({ id: i })) : [{ id: 100 }]));
  });

  assert.equal((await client.list("/repos/example/project/issues")).length, 101);
  assert.equal(calls, 2);
});

test("accepted asynchronous operations permit an empty 202 body without repeating the write", async () => {
  let calls = 0;
  const client = api("test", async () => { calls++; return new Response(null, { status: 202 }); });
  assert.equal(await client.request("POST", "/repos/example/project/actions/runs/42/cancel"), null);
  assert.equal(calls, 1);
});

test("transient read failures retry within a bound but mutations and unknown writes never retry", async () => {
    for (const [method, path, body, expected] of [
      ["GET", "/repos/example/project", undefined, 3],
      ["POST", "/graphql", { query: "query { viewer { login } }" }, 3],
      ["POST", "/repos/example/project/issues/1/assignees", {}, 1],
      ["POST", "/repos/example/project/git/refs", {}, 1],
      ["DELETE", "/repos/example/project/git/refs/tags/lock", undefined, 1],
      ["POST", "/graphql", { query: "mutation { dangerous }" }, 1],
    ]) {
      let calls = 0;
      const client = api("test", async () => {
        calls++;
        return calls < 3 ? new Response(null, { status: 503, headers: { "Retry-After": "0" } })
          : new Response('{"ok":true}', { status: 200 });
      });
      if (expected === 3) assert.deepEqual(await client.request(method, path, body), { ok: true });
      else await assert.rejects(client.request(method, path, body), /Operation:/);
      assert.equal(calls, expected);
    }
    let failures = 0;
    const unavailable = api("test", async () => { failures++; return new Response(null, { status: 503, headers: { "Retry-After": "0" } }); });
    await assert.rejects(unavailable.request("GET", "/repos/example/project"), /HTTP 503/);
    assert.equal(failures, 3);
    let longWaits = 0;
    const throttled = api("test", async () => { longWaits++; return new Response(null, { status: 503, headers: { "Retry-After": "120" } }); });
    await assert.rejects(throttled.request("GET", "/repos/example/project"), /HTTP 503/);
    assert.equal(longWaits, 1, "A long Retry-After must not be shortened into an early retry.");
});

test("PR descriptions include concise rationale and real check statements", () => {
  checkPrDescription("## What changed\nPreserved the default when no preference is saved.\n## Why\nExisting callers depend on it.\n## Checks\nRegression test added; execution not run here.");
  checkPrDescription("Independent review.\n\n## Findings\nNone.", undefined);
  assert.throws(() => checkPrDescription("<!-- crewbie-attribution -->x<!-- /crewbie-attribution -->"), /empty/);
});

test("PR handoff finalization is previewable, human-authorized and bound to current head/body", async () => {
  const original = "GitHub generated a different summary.";
  const body = "## What changed\nFocused fix.\n## Why\nPreserve the API.\n## Checks\nnpm test: 4 passed.";
  const pr = { state: "open", head: { sha: "head" }, body: original };
  const writes = [];
  let login = "maintainer";
  const client = { async request(method, path, data) {
    if (path === "/user") return { type: "User", login };
    if (path.includes("/collaborators/")) return { permission: login === "maintainer" ? "write" : "read" };
    if (method === "GET") return pr;
    writes.push(data); return { ...pr, body: data.body };
  } };
  const proposal = { headSha: "head", beforeHash: hash(original), body };
  assert.equal((await publishDescription(client, config(), 2, proposal)).after, body);
  assert.equal(writes.length, 0);
  login = "stranger";
  await assert.rejects(publishDescription(client, config(), 2, proposal, true), /write access/);
  login = "maintainer";
  await publishDescription(client, config(), 2, proposal, true);
  assert.deepEqual(writes, [{ body }]);
  pr.head.sha = "new-head";
  await assert.rejects(publishDescription(client, config(), 2, proposal, true), /changed/);
  pr.head.sha = "head"; pr.body = "Human edited the description.";
  await assert.rejects(publishDescription(client, config(), 2, proposal, true), /changed/);
  assert.equal(writes.length, 1);
});

test("GitHub API errors include GitHub's message field, never the raw body", async () => {
  const client = api("test-secret", async () => new Response(JSON.stringify({ message: "Resource not accessible by personal access token", extra: "raw body detail" }), { status: 403 }));
  await assert.rejects(client.request("POST", "/agents/repos/example/project/tasks", {}), (error) => {
    assert.match(error.message, /HTTP 403.*Operation: POST \/agents\/repos\/example\/project\/tasks\. GitHub said: Resource not accessible by personal access token/);
    assert.doesNotMatch(error.message, /test-secret|raw body detail/);
    return true;
  });
  const plain = api("test", async () => new Response("not json", { status: 500 }));
  await assert.rejects(plain.request("POST", "/x", {}), (error) => !/GitHub said|not json/.test(error.message));
});

test("reapprove moves open tasks to the owner's configured model and approves the exact new issue", async () => {
  const cfg = config();
  const b = parseBatch(batch(), cfg);
  const oldBody = issueBody(b, { ...b.tasks[0], model: "retired-model" });
  const issues = { 1: { number: 1, state: "open", title: b.tasks[0].title, body: oldBody }, 2: { number: 2, state: "closed", title: "x", body: oldBody } };
  const comments = { 1: [] }, writes = [];
  let login = "someone";
  const client = {
    async list(path) { return comments[Number(path.match(/issues\/(\d+)\/comments/)[1])] ?? []; },
    async request(method, path, body) {
      if (path === "/user") return { type: "User", login };
      if (path.includes("/collaborators/")) return { permission: login === "maintainer" ? "write" : "read" };
      if (path.includes("/git/ref/tags/crewbie/claims/1")) return { object: { sha: "x" } };
      const number = Number(path.match(/issues\/(\d+)/)?.[1]);
      if (method === "GET") return structuredClone(issues[number]);
      writes.push({ method, path });
      if (method === "PATCH") { issues[number].body = body.body; return {}; }
      if (method === "POST") { comments[number].push({ user: { type: "User", login }, body: body.body, created_at: "t", updated_at: "t" }); return {}; }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  assert.match(await reapproveIssues(client, cfg, [1], false), /#1: model retired-model -> approved-model for crewbie-developer; add crewbie:restart/);
  assert.equal(writes.length, 0, "Preview writes nothing.");
  await assert.rejects(reapproveIssues(client, cfg, [1], true), /write access/);
  assert.equal(writes.length, 0);
  login = "maintainer";
  assert.match(await reapproveIssues(client, cfg, [1], true), /Updated and re-approved/);
  assert.equal(taskMetadata(issues[1].body).task.model, "approved-model");
  assert.deepEqual({ ...taskMetadata(issues[1].body).task, model: "retired-model" }, taskMetadata(oldBody).task, "Only the model changes.");
  assert.ok(await approvedIn(client, comments[1], cfg, issues[1]));
  assert.match(await reapproveIssues(client, cfg, [1], true), /already approved[\s\S]*Nothing to change/);
  await assert.rejects(reapproveIssues(client, cfg, [2], false), /closed/);
});
