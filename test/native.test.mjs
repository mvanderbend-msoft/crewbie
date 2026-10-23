import test from "node:test";
import assert from "node:assert/strict";
import { awaitPullSessions } from "../dist/tracking/native.js";
import { GitHubError } from "../dist/execution/github.js";

const pull = (id, state) => ({ id, state, artifacts: [{ provider: "github", type: "pull", data: { id: 1001 } }] });
function sessions(states) {
  const reads = [];
  const client = { async request(method, path) {
    reads.push(path);
    const state = states[Math.min(reads.length - 1, states.length - 1)];
    if (state instanceof Error) throw state;
    return { tasks: [pull("task-1", state), { id: "other", state: "in_progress", artifacts: [] }] };
  } };
  return { client, reads };
}
const fast = { intervalMs: 10, timeoutMs: 30, sleep: async () => {} };

test("dispatch triggered by Copilot's review request waits until the task API reports the PR's session ended", async () => {
  const { client, reads } = sessions(["in_progress", "in_progress", "completed"]);
  assert.equal(await awaitPullSessions(client, "o/r", 1001, fast), true);
  assert.equal(reads.length, 3);
});

test("waiting for a finished session is bounded and does not wait on other PRs' sessions", async () => {
  const stuck = sessions(["in_progress"]);
  assert.equal(await awaitPullSessions(stuck.client, "o/r", 1001, fast), false);
  assert.equal(stuck.reads.length, 4);
  const other = sessions(["in_progress"]);
  assert.equal(await awaitPullSessions(other.client, "o/r", 2002, fast), true);
  assert.equal(other.reads.length, 1);
  const denied = sessions([new GitHubError(403, null)]);
  assert.equal(await awaitPullSessions(denied.client, "o/r", 1001, fast), false);
  assert.equal(denied.reads.length, 1);
});
