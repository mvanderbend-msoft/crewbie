import test from "node:test";
import assert from "node:assert/strict";
import { GitHubError } from "../dist/core.js";
import { parseConfig } from "../dist/config.js";
import { baselineLaunches, launchAllowance, reserveLaunch, setLaunchPause, withDispatchLock } from "../dist/execution/controls.js";
import { cancelRun } from "../dist/execution/cancel.js";
import { issueBody, taskMetadata } from "../dist/specification/batch.js";
import { config, batch } from "./helpers.mjs";

function fixture() {
  // Default-branch task (pre-feature-branch), whose PR GitHub links through closing references.
const b = batch(), metadata = taskMetadata(issueBody(b, b.tasks[0])), BRANCH = metadata.branch;
  const state = { refs: new Set(), objects: new Map(), comments: {}, tag: null, writes: [], user: "maintainer", cancelled: false, denial: false, confirmation: false };
  const run = { id: 42, run_attempt: 1, event: "dynamic", repository: { full_name: "example/project" }, head_branch: "copilot/work", pull_requests: [{ id: 100 }], status: "in_progress" };
  const client = {
    async list(path) {
      if (path.includes("/git/matching-refs/")) return [...state.refs].filter((ref) => ref.startsWith(`refs/${path.split("/git/matching-refs/")[1]}`)).map((ref) => ({ ref, object: state.objects.get(ref) }));
      const comments = /\/issues\/(\d+)\/comments$/.exec(path);
      if (comments) return state.comments[comments[1]] ?? [];
      if (path.endsWith("/issues/1/timeline")) return [{ event: "cross-referenced", source: { issue: { pull_request: { url: "https://api.github.com/repos/example/project/pulls/10" } } } }];
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      if (method !== "GET" && path !== "/graphql") state.writes.push({ method, path, body });
      if (path === "/user") return { type: "User", login: state.user };
      if (path === "/repos/example/project") return { default_branch: "main" };
      if (path.endsWith("/branches/main")) return { commit: { sha: "a".repeat(40) } };
      if (method === "POST" && path.endsWith("/git/tags")) { state.tag = body; return { sha: "b".repeat(40) }; }
      if (method === "GET" && path.includes("/git/tags/")) return state.tag;
      if (path.includes("/git/ref/")) {
        const ref = `refs/${path.split("/git/ref/")[1]}`;
        if (!state.refs.has(ref)) throw new GitHubError(404, null);
        return {};
      }
      if (method === "POST" && path.endsWith("/git/refs")) {
        if (state.refs.has(body.ref)) throw new GitHubError(422, null);
        state.refs.add(body.ref);
        if (body.ref.endsWith("/baseline")) state.objects.set(body.ref, { type: "tag", sha: body.sha });
        return {};
      }
      if (method === "DELETE" && path.includes("/git/refs/")) { state.refs.delete(`refs/${path.split("/git/refs/")[1]}`); return null; }
      if (path.endsWith("/issues/1")) return { body: issueBody(b, b.tasks[0]) };
      if (path === "/graphql") return { data: { repository: { issue: { closedByPullRequestsReferences: {
        nodes: [{ number: 10, repository: { nameWithOwner: "example/project" } }], pageInfo: { hasNextPage: false },
      } } } } };
      if (path.endsWith("/pulls/10")) return { id: 100, number: 10, user: { login: "Copilot" }, head: { ref: "copilot/work", repo: { full_name: "example/project" } }, base: { ref: BRANCH } };
      if (path.endsWith("/actions/runs/42/cancel")) {
        if (state.denial) throw new GitHubError(403, null);
        state.cancelled = true;
        if (state.confirmation) Object.assign(run, { status: "completed", conclusion: "cancelled" });
        return null;
      }
      if (path.endsWith("/actions/runs/42")) return structuredClone(run);
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  return { state, client, metadata, run };
}

test("validated optional policy preserves legacy hashes and defaults to explicit 20/3 allowances", async () => {
  assert.equal(parseConfig(config()).execution, undefined);
  assert.throws(() => parseConfig(config({ modelProfile: "cheapest" })), /Model profile/);
  for (const execution of [{ maxLaunchesPerBatch: 0, maxAttemptsPerTask: 1 }, { maxLaunchesPerBatch: 20, maxAttemptsPerTask: -1 }]) assert.throws(() => parseConfig(config({ execution })));
  const f = fixture();
  const allowance = await launchAllowance(f.client, config(), f.metadata, 1);
  assert.equal(allowance.maxLaunchesPerBatch, 20);
  assert.equal(allowance.maxAttemptsPerTask, 3);
});

test("persistent reservations are shared, capped at exactly three attempts, and never refunded", async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) await withDispatchLock(f.client, config(), () => reserveLaunch(f.client, config(), f.metadata, 1, "a".repeat(40)));
  await assert.rejects(withDispatchLock(f.client, config(), () => reserveLaunch(f.client, config(), f.metadata, 1, "a".repeat(40))), /Task attempt allowance exhausted/);
  assert.equal(f.state.refs.size, 3);
  assert.equal((await launchAllowance(f.client, config(), f.metadata, 1)).used, 3);
});

test("each launch that Copilot verifiably could not start is not counted as an attempt", async () => {
  const f = fixture();
  const task = f.metadata.task.id, ledger = (issue, n) => `refs/tags/crewbie/launches/${f.metadata.batch}/${task}/${issue}/${n}`;
  for (const [issue, n] of [[16, 1], [24, 2], [39, 3]]) f.state.refs.add(ledger(issue, n));
  const failure = { user: { type: "Bot", login: "Copilot" }, body: "The agent encountered an error and was unable to start working on this issue: Please try again later." };
  f.state.comments["39"] = [failure];
  f.state.comments["24"] = [{ ...failure, user: { type: "User", login: "someone" } }];
  const allowance = await launchAllowance(f.client, config(), f.metadata, 46);
  assert.equal(allowance.taskUsed, 2, "Only Copilot's own start-failure report releases the attempt.");
  assert.equal(allowance.used, 2);
  assert.equal(allowance.blocked, null);
  f.state.refs.add(ledger(39, 4));
  assert.equal((await launchAllowance(f.client, config(), f.metadata, 46)).taskUsed, 3, "A restart counts; only the launch Copilot could not start is released.");
  f.state.comments["39"] = [failure, { user: { type: "User", login: "maintainer" }, body: "restart <!-- crewbie-restart:4 -->" }, failure];
  assert.equal((await launchAllowance(f.client, config(), f.metadata, 46)).taskUsed, 2, "Every verified start failure releases one launch.");
});

test("pre-upgrade attempts need a human-attested baseline that consumes rather than resets allowance", async () => {
  const f = fixture();
  f.state.refs.add("refs/tags/crewbie/claims/1");
  assert.match((await launchAllowance(f.client, config(), f.metadata, 1)).blocked, /pre-ledger claim/);
  assert.match(await baselineLaunches(f.client, config(), 1, 2, false), /YOUR attestation/);
  assert.equal(f.state.writes.length, 0);
  await baselineLaunches(f.client, config(), 1, 2, true);
  const allowance = await launchAllowance(f.client, config(), f.metadata, 1);
  assert.equal(allowance.blocked, null);
  assert.equal(allowance.used, 2);
  assert.equal(allowance.taskUsed, 2);
  await reserveLaunch(f.client, config(), f.metadata, 1, "a".repeat(40));
  await assert.rejects(reserveLaunch(f.client, config(), f.metadata, 1, "a".repeat(40)), /allowance exhausted/);
  await assert.rejects(baselineLaunches(f.client, config(), 1, 1, true), /cannot overwrite or refund/);
});

test("pause/resume requires a human, uses the dispatch lock and never resets launch history", async () => {
  const f = fixture();
  await reserveLaunch(f.client, config(), f.metadata, 1, "a".repeat(40));
  f.state.writes = [];
  assert.match(await setLaunchPause(f.client, config(), true, false), /Preview/);
  assert.equal(f.state.writes.length, 0);
  f.state.user = "outsider";
  await assert.rejects(setLaunchPause(f.client, config(), true, true), /human approver/);
  f.state.user = "maintainer";
  await setLaunchPause(f.client, config(), true, true);
  assert.match((await launchAllowance(f.client, config(), f.metadata, 1)).blocked, /paused/);
  await setLaunchPause(f.client, config(), false, true);
  assert.equal((await launchAllowance(f.client, config(), f.metadata, 1)).used, 1);
  assert.ok(f.state.writes.every((write) => !write.path.includes("/agents/")));
});

test("cancel previews only attributable cloud runs and distinguishes requested from confirmed cancellation", async () => {
  for (const confirmation of [false, true]) {
    const f = fixture(); f.state.confirmation = confirmation;
    assert.match(await cancelRun(f.client, config(), 1, 42, false), /Preview/);
    assert.equal(f.state.writes.length, 0);
    const result = await cancelRun(f.client, config(), 1, 42, true);
    assert.match(result, confirmation ? /cancellation confirmed/ : /requested, not confirmed/);
    assert.equal(f.state.cancelled, true);
    assert.ok(f.state.writes.every((write) => !write.path.includes("/agents/")));
  }
  const f = fixture(); f.run.event = "push";
  await assert.rejects(cancelRun(f.client, config(), 1, 42, true), /not an attributable/);
  assert.equal(f.state.writes.length, 0);
});

test("unsupported cancellation and outsider credentials never claim that an agent stopped", async () => {
  const f = fixture(); f.state.user = "outsider";
  await assert.rejects(cancelRun(f.client, config(), 1, 42, true), /human approver/);
  assert.equal(f.state.cancelled, false);
  f.state.user = "maintainer"; f.state.denial = true;
  await assert.rejects(cancelRun(f.client, config(), 1, 42, true), /not confirmed.*Stop session/);
  assert.equal(f.state.refs.size, 0);
  const uncertain = { ...f.client, async request(method, path, body) {
    if (path.endsWith("/cancel")) throw new TypeError("connection interrupted");
    return f.client.request(method, path, body);
  } };
  await assert.rejects(cancelRun(uncertain, config(), 1, 42, true), /Cancellation was not confirmed.*inspect the run before retrying/);
});
