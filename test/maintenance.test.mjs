import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../dist/core.js";
import { GitHubError } from "../dist/execution/github.js";
import { publishProposal, parseProposal } from "../dist/memory/improvement.js";
import { readState, saveState } from "../dist/memory/state.js";
import { config, run } from "./helpers.mjs";
import { runRecord } from "../dist/reporting/records.js";

test("missing runtime state is initialization; a broken existing state is an error", async () => {
  const missing = { request: async () => { throw new GitHubError(404, null); } };
  assert.deepEqual(await readState(missing, "example/project"), { processed: {}, revision: null });
  const broken = { request: async (_method, path) => {
    if (path.includes("/git/ref/")) return { object: { sha: "existing" } };
    throw new GitHubError(404, null);
  } };
  await assert.rejects(readState(broken, "example/project"), /HTTP 404/);
});

test("operational cursor updates use a separate branch with optimistic non-force updates", async () => {
  const calls = [];
  const client = { request: async (method, path, body) => {
    calls.push({ method, path, body });
    return { sha: path.endsWith("/trees") ? "tree" : "new-commit" };
  } };
  await saveState(client, "example/project", { processed: { run1: { fingerprint: "hash", outcome: "No justified change." } }, revision: "old-commit" });
  assert.deepEqual(calls.find((call) => call.path.endsWith("/git/commits")).body.parents, ["old-commit"]);
  assert.equal(calls.at(-1).body.force, false);
  assert.match(calls.at(-1).path, /crewbie\/runtime$/);
  assert.equal(calls[0].body.tree[0].path, "state.json");
});

function proposalFixture({ active = false, behind = 0, old = "Existing lesson." } = {}) {
  const calls = [];
  let branch = active ? "proposal-parent" : null;
  const client = {
    async list() { return active ? [{ number: 12, body: "Earlier reviewed context." }] : []; },
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (path === "/repos/example/project") return { default_branch: "main" };
      if (path.endsWith("/git/ref/heads/main")) return { object: { sha: "base" } };
      if (path.includes("/compare/")) return { behind_by: behind };
      if (path.endsWith("/git/ref/heads/crewbie/improvements")) {
        if (!branch) throw new GitHubError(404, null);
        return { object: { sha: branch } };
      }
      if (path.includes("/git/commits/")) return { tree: { sha: "old-tree" } };
      if (path.includes("/contents/")) return { encoding: "base64", type: "file", content: Buffer.from(old).toString("base64") };
      if (path.endsWith("/git/trees")) return { sha: "new-tree" };
      if (path.endsWith("/git/commits")) return { sha: "new-commit" };
      if (path.endsWith("/git/refs") || path.endsWith("/git/refs/heads/crewbie/improvements")) { branch = body.sha; return {}; }
      if (path.endsWith("/pulls") || path.endsWith("/pulls/12")) return { html_url: "https://github.com/example/project/pull/12" };
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  const proposal = parseProposal({
    summary: "Use a focused regression test because the reviewer found an uncovered edge case.",
    changes: [{ path: ".crewbie/team/improver/hot.md", beforeHash: hash(old), content: "Add a regression test for the changed edge case. Source: PR #1.", reason: "Review feedback identified a gap.", evidence: ["evidence"] }],
  });
  return { calls, client, proposal };
}

test("new improvement creates only a review branch and PR, never a default-branch commit or merge", async () => {
  const fixture = proposalFixture();
  const url = await publishProposal(fixture.client, config(), fixture.proposal, [runRecord(run())]);
  assert.match(url, /pull\/12$/);
  const mutations = fixture.calls.filter((call) => call.method !== "GET");
  assert.ok(mutations.some((call) => call.body?.ref === "refs/heads/crewbie/improvements"));
  assert.ok(!mutations.some((call) => call.path.endsWith("/merge") || call.path.endsWith("/heads/main")));
  assert.match(mutations.find((call) => call.path.endsWith("/pulls")).body.body, /^\*\*Specialist:\*\* `crewbie-improver`/);
  assert.match(mutations.find((call) => call.path.endsWith("/git/commits")).body.message, /Co-authored-by: Copilot/);
});

test("remote guidance accepts legacy CRLF fingerprints only for equivalent text", async () => {
  const fixture = proposalFixture({ old: "Existing lesson.\nSource: PR #1.\n" });
  fixture.proposal.changes[0].beforeHash = hash("Existing lesson.\r\nSource: PR #1.\r\n");
  await publishProposal(fixture.client, config(), fixture.proposal, [runRecord(run())]);
  const changed = proposalFixture({ old: "A changed lesson.\nSource: PR #1.\n" });
  changed.proposal.changes[0].beforeHash = fixture.proposal.changes[0].beforeHash;
  await assert.rejects(publishProposal(changed.client, config(), changed.proposal, [runRecord(run())]), /changed remotely/);
  assert.ok(changed.calls.every((call) => call.method === "GET"));
});

test("active improvement PR is updated and a stale branch stops before mutations", async () => {
  const fixture = proposalFixture({ active: true });
  await publishProposal(fixture.client, config(), fixture.proposal, [runRecord(run())]);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/pulls")).length, 0);
  assert.ok(fixture.calls.some((call) => call.method === "PATCH" && call.path.endsWith("/pulls/12")));
  const stale = proposalFixture({ active: true, behind: 1 });
  await assert.rejects(publishProposal(stale.client, config(), stale.proposal, [runRecord(run())]), /behind its base/);
  assert.ok(stale.calls.every((call) => call.method === "GET"));
});
