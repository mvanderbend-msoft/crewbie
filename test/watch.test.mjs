import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { batchWork, eligible } from "../dist/execution/dispatch.js";
import { watchBatch } from "../dist/execution/watch.js";
import { approvedBatch, issueBody, parseBatch, taskMetadata } from "../dist/specification/batch.js";
import { batch, config } from "./helpers.mjs";

function scenario() {
  const approved = approvedBatch(parseBatch(batch(), config()), true);
  const work = approved.tasks.map((task, index) => ({
    issue: { number: index + 1, title: task.title, body: issueBody(approved, task) },
    metadata: taskMetadata(issueBody(approved, task)),
    approved: true, claimed: true, state: "running", reason: "active",
  }));
  return { approved, work };
}

test("watch automatically reconciles a changing graph through cloud handoff without merging", async () => {
  const { approved, work } = scenario();
  let calls = 0;
  const progress = [];
  const result = await watchBatch(approved, async () => {
    calls++;
    if (calls === 2) for (const item of work) Object.assign(item, { state: "review", sessionComplete: true });
    return work;
  }, { pollMs: 1, progress: (work) => progress.push(work.map((item) => item.state)) });
  assert.equal(result.outcome, "handoff");
  assert.equal(calls, 2);
  assert.equal(progress.length, 2);
  assert.ok(result.work.every((item) => item.state !== "done"));
});

test("watch stops on human merge gates and failures instead of silently merging or retrying", async () => {
  for (const state of ["blocked", "failed"]) {
    const { approved, work } = scenario();
    for (const item of work) item.state = state;
    const result = await watchBatch(approved, async () => work);
    assert.equal(result.outcome, "blocked");
    assert.equal(result.rounds, 1);
  }
});

test("watch times out honestly without cancelling or relaunching the cloud work", async () => {
  const { approved, work } = scenario();
  const result = await watchBatch(approved, async () => { await setTimeout(5); return work; }, { timeoutMs: 1 });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.rounds, 1);
  assert.ok(result.work.every((item) => item.claimed));
});

test("watch fails closed on missing approval, changed scope, missing tasks and API errors", async () => {
  const { approved, work } = scenario();
  await assert.rejects(watchBatch({ ...approved, approval: null }, async () => work), /unapproved/);
  await assert.rejects(watchBatch(approvedBatch(approved, false), async () => work), /execution approval/);
  assert.throws(() => batchWork(work.slice(1), approved), /incomplete/);
  work[0].issue.body += "\nChanged scope";
  await assert.rejects(watchBatch(approved, async () => work), /differs/);
  await assert.rejects(watchBatch(approved, async () => { throw new Error("API failed"); }), /API failed/);
});

test("batch-scoped selection keeps repository-wide capacity without launching another batch", () => {
  const { work } = scenario();
  for (const item of work) Object.assign(item, { state: "ready", claimed: false });
  const unrelated = structuredClone(work[0]);
  unrelated.metadata.batch = "other";
  unrelated.metadata.task.priority = 0;
  assert.ok(eligible([unrelated, ...work], 2, "feature").every((item) => item.metadata.batch === "feature"));
  Object.assign(unrelated, { state: "running", claimed: true });
  assert.equal(eligible([unrelated, ...work], 2, "feature").length, 1);
});
