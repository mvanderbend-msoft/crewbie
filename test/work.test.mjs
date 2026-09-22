import test from "node:test";
import assert from "node:assert/strict";
import { approvedBatch, batchDigest, parseBatch, requireApproval, issueBody, issueDigest, taskMetadata } from "../dist/specification/batch.js";
import { eligible } from "../dist/execution/dispatch.js";
import { approvalComment, hasApproval, publish, publishDescription } from "../dist/tracking/issues.js";
import { hash } from "../dist/core.js";
import { api } from "../dist/tracking/github.js";
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

test("explicit review tasks wait for completed sessions, while implementation still waits for merge", () => {
  const ready = { ...work("a", { state: "review", claimed: true }), sessionComplete: true };
  const review = work("b", { dependencies: ["a"] });
  review.metadata.task.kind = "review";
  const implement = work("c", { dependencies: ["a"] });
  assert.deepEqual(eligible([ready, review, implement], 2).map((item) => item.metadata.task.id), ["b"]);
  const pending = work("b", { dependencies: ["a"] });
  pending.metadata.task.kind = "review";
  assert.deepEqual(eligible([{ ...ready, sessionComplete: false }, pending], 2), []);
  const b = parseBatch({ ...batch(), tasks: [{ ...task("inspect"), kind: "review" }] }, config());
  assert.equal(taskMetadata(issueBody(b, b.tasks[0])).task.kind, "review");
  assert.throws(() => parseBatch({ ...batch(), tasks: [{ ...task("inspect"), kind: "bypass" }] }), /kind/);
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
  const client = { list: async () => [comment] };
  assert.equal(await hasApproval(client, config(), issue), true);
  assert.equal(await hasApproval(client, config(), { ...issue, body: "Tampered" }), false);
  comment.user.login = "untrusted";
  assert.equal(await hasApproval(client, config(), issue), false);
  comment.user.login = "maintainer"; comment.updated_at = "edited";
  assert.equal(await hasApproval(client, config(), issue), false);
  comment.user = null;
  assert.equal(await hasApproval(client, config(), issue), false, "deleted accounts cannot authorize work or break reconciliation");
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
  assert.throws(() => checkPrDescription("## Summary\nUpdated the code.\n## Checks\nPassed."), /Why/);
  assert.throws(() => checkPrDescription("## What changed\n\n## Why\nReason.\n## Checks\nNot run."), /empty/);
});

test("PR handoff finalization is previewable, human-authorized and bound to current head/body", async () => {
  const original = "GitHub generated a different summary.";
  const body = "## What changed\nFocused fix.\n## Why\nPreserve the API.\n## Checks\nnpm test: 4 passed.";
  const pr = { state: "open", head: { sha: "head" }, body: original };
  const writes = [];
  let login = "maintainer";
  const client = { async request(method, path, data) {
    if (path === "/user") return { type: "User", login };
    if (method === "GET") return pr;
    writes.push(data); return { ...pr, body: data.body };
  } };
  const proposal = { headSha: "head", beforeHash: hash(original), body };
  assert.equal((await publishDescription(client, config(), 2, proposal)).after, body);
  assert.equal(writes.length, 0);
  login = "stranger";
  await assert.rejects(publishDescription(client, config(), 2, proposal, true), /human approver/);
  login = "maintainer";
  await publishDescription(client, config(), 2, proposal, true);
  assert.deepEqual(writes, [{ body }]);
  pr.head.sha = "new-head";
  await assert.rejects(publishDescription(client, config(), 2, proposal, true), /changed/);
  pr.head.sha = "head"; pr.body = "Human edited the description.";
  await assert.rejects(publishDescription(client, config(), 2, proposal, true), /changed/);
  assert.equal(writes.length, 1);
});
