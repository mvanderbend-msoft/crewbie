import test from "node:test";
import assert from "node:assert/strict";
import { collectPrUsage, parseUsageLog, renderPrUsage, UsageUnavailable } from "../dist/reporting/pr-usage.js";
import { GitHubError } from "../dist/core.js";

const session = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const log = (id, input = 10, output = 3) => `COPILOT_AGENT_SESSION_ID: ${id}\n[cca-engine] turn=1 assistant.usage: model=fixture input=${input} output=${output}\n`;
function fixture() {
  const pr = { id: 13, head: { ref: "copilot/feature" } };
  const state = { sessions: [session("a"), session("b")], denied: false };
  const client = {
    async request(_method, path) {
      if (state.denied) throw new GitHubError(403, null);
      if (path.startsWith("/agents/repos/example/project/tasks?")) return { tasks: [{ id: "task-1", artifacts: [{ provider: "github", type: "pull", data: { id: 13 } }] }] };
      if (path.endsWith("/tasks/task-1")) return { session_count: state.sessions.length, sessions: state.sessions.map((id) => ({ id, usage: { type: "ai_credits", amount: 100000000 } })) };
      if (path.includes("/actions/runs?")) return { workflow_runs: [
        { id: 1, status: "completed", pull_requests: [{ id: 13 }] },
        { id: 2, status: "completed", pull_requests: [{ id: 13 }] },
        { id: 3, status: "completed", pull_requests: [{ id: 99 }] },
      ] };
      throw new Error(`Unexpected read: ${path}`);
    },
  };
  return { state, client, pr };
}

test("usage parsing deduplicates exact log repetition and rejects conflicting counts or session identity", () => {
  assert.deepEqual(parseUsageLog(log(session("a")) + log(session("a"))), { sessionId: session("a"), inputTokens: 10, outputTokens: 3 });
  assert.equal(parseUsageLog(log(session("a")) + log(session("a"), 11)), null);
  assert.equal(parseUsageLog(log(session("a")) + log(session("b"))), null);
  assert.equal(parseUsageLog("[cca-engine] turn=1 assistant.usage: model=x input=1 output=2"), null);
});

test("PR usage aggregates attributable sessions and does not invent credit scaling", async () => {
  const f = fixture();
  const result = await collectPrUsage(f.client, "example/project", f.pr, (_repo, run) => log(session(run === 1 ? "a" : "b")));
  assert.equal(result.inputTokens, 20);
  assert.equal(result.outputTokens, 6);
  assert.equal(result.credits, null);
  assert.equal(result.measuredSessions, 2);
  assert.equal(result.sources.length, 2);
  assert.match(renderPrUsage(result), /26 \(20 input \+ 6 output\)/);
  assert.match(renderPrUsage(result), /AI credits:\*\* unavailable/);
});

test("missing logs or denied telemetry stay explicitly partial/unknown, never zero", async () => {
  const f = fixture();
  const partial = await collectPrUsage(f.client, "example/project", f.pr, (_repo, run) => {
    if (run === 2) throw new UsageUnavailable("Logs expired.");
    return log(session("a"));
  });
  assert.equal(partial.measuredSessions, 1);
  assert.match(renderPrUsage(partial), /Coverage incomplete/);
  f.state.denied = true;
  const denied = await collectPrUsage(f.client, "example/project", f.pr);
  assert.equal(denied.inputTokens, null);
  assert.match(renderPrUsage(denied), /tokens:\*\* unavailable/);
});

test("duplicate sessions cannot double-count usage", async () => {
  const f = fixture();
  f.state.sessions = [session("a"), session("a")];
  await assert.rejects(collectPrUsage(f.client, "example/project", f.pr), /Duplicate native session/);
});
