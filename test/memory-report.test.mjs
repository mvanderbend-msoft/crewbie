import test from "node:test";
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { fixture, config, run, batch } from "./helpers.mjs";
import { issueBody, parseBatch } from "../dist/specification/batch.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { memoryContext, relevantTopics } from "../dist/memory/context.js";
import { allowedPath, parseProposal, selectEvidence, validateProposal } from "../dist/memory/improvement.js";
import { collectRecords, evidenceId, parseRecords, runRecord } from "../dist/reporting/records.js";
import { dashboard } from "../dist/reporting/dashboard.js";
import { hash } from "../dist/core.js";

test("each role reads shared guidance and only its own bounded history", async (t) => {
  const root = await fixture(t);
  const cfg = config({ nightly: { ...config().nightly, enabled: true } });
  await applyInstallation(root, await installation(root, { config: cfg, constitutionText: null }));
  const context = await memoryContext(root, cfg, "improver");
  assert.deepEqual(context.map((file) => file.path), [".crewbie/instructions.md", ".crewbie/decisions.md", ".crewbie/team/improver/hot.md", ".crewbie/team/improver/index.md"]);
  assert.ok(context.every((file) => file.sha256 === hash(file.content)));
  await assert.rejects(memoryContext(root, cfg, "missing"), /configured role/);
  await assert.rejects(memoryContext(root, cfg, "improver", ["../../escape"]), /Memory topic/);
  await unlink(join(root, ".crewbie/instructions.md"));
  await assert.rejects(memoryContext(root, cfg, "improver"), /Required shared working rules are missing/);
});

test("deferred memory proposals reach nightly evidence without accepting arbitrary comment authors", async () => {
  const cfg = config();
  const b = parseBatch(batch(), cfg);
  const client = {
    async list(path) {
      if (path.includes("/issues?")) return [{ number: 1, body: issueBody(b, b.tasks[0], false), updated_at: "2026-09-22T07:00:00Z" }];
      if (path.endsWith("/timeline")) return [{ event: "cross-referenced", source: { issue: { pull_request: { url: "https://api.github.com/repos/example/project/pulls/2" } } } }];
      if (path.endsWith("/issues/2/comments")) return [
        { id: 8, user: { login: "Copilot", type: "Bot" }, updated_at: "2026-09-22T08:00:00Z", body: "<!-- crewbie-memory-proposal -->\nPropose a primitive-string regression lesson in developer/hot.md. Source: PR #2." },
        { id: 9, user: { login: "stranger", type: "User" }, updated_at: "2026-09-22T09:00:00Z", body: "<!-- crewbie-memory-proposal -->\nUNTRUSTED-PROPOSAL" },
      ];
      if (path.endsWith("/reviews") || path.includes("/pulls?")) return [];
      throw new Error(`Unexpected ${path}`);
    },
    async request(_method, path) {
      if (path === "/graphql") return { data: { repository: { issue: { closedByPullRequestsReferences: {
        nodes: [{ number: 2, repository: { nameWithOwner: "example/project" } }], pageInfo: { hasNextPage: false, endCursor: null },
      } } } } };
      if (path.endsWith("/pulls/2")) return { number: 2, body: "Focused change.", state: "open", user: { login: "Copilot" }, updated_at: "2026-09-22T07:00:00Z", head: { sha: "head" } };
      if (path.includes("/check-runs")) return { check_runs: [] };
      throw new Error(`Unexpected ${path}`);
    },
  };
  const records = await collectRecords(client, cfg);
  assert.match(records[0].summary, /primitive-string regression lesson/);
  assert.doesNotMatch(records[0].summary, /UNTRUSTED-PROPOSAL/);
  assert.equal(records[0].date, "2026-09-22T08:00:00.000Z");
});

test("closing an unexecuted issue is reported without inventing a completed session", async () => {
  const cfg = config(), b = parseBatch(batch(), cfg);
  const client = {
    async list(path) {
      return path.includes("/issues?") ? [{ number: 1, state: "closed", body: issueBody(b, b.tasks[0], false), updated_at: "2026-09-22T08:00:00Z" }] : [];
    },
    async request(_method, path) {
      assert.equal(path, "/graphql");
      return { data: { repository: { issue: { closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } };
    },
  };
  const [record] = await collectRecords(client, cfg);
  assert.equal(record.status, "closed-unmerged");
  assert.equal(record.kind, "work-item");
  assert.equal(record.sessionId, null);
});

test("nightly evidence cap preserves backlog and skips consumed records", () => {
  const runs = Array.from({ length: 25 }, (_, index) => runRecord(run({ id: `run-${index}` })));
  const first = selectEvidence(runs, new Set(), 20);
  assert.equal(first.length, 20);
  const second = selectEvidence(runs, new Set(first.map(evidenceId)), 20);
  assert.equal(second.length, 5);
  assert.equal(selectEvidence(runs, new Set(runs.map(evidenceId)), 20).length, 0);
});

test("proposal validation rejects permissions, unknown evidence, stale hashes and excessive memory", async (t) => {
  const root = await fixture(t, { ".crewbie/team/improver/hot.md": "Existing lesson." });
  const cfg = config({ nightly: { ...config().nightly, enabled: true } });
  const evidence = [runRecord(run())];
  const change = { path: ".crewbie/team/improver/hot.md", beforeHash: hash("Existing lesson."), content: "Use a targeted regression test. Source: PR #1.", reason: "Reviewer identified a missing test.", evidence: [evidenceId(evidence[0])] };
  const proposal = parseProposal({ summary: "Make test guidance specific.", changes: [change] });
  await validateProposal(root, cfg, proposal, evidence);
  for (const extra of [{ path: ".github/workflows/unsafe.yml" }, { beforeHash: "stale" }, { evidence: ["invented"] }, { content: "word ".repeat(601) }]) {
    await assert.rejects(validateProposal(root, cfg, { ...proposal, changes: [{ ...change, ...extra }] }, evidence));
  }
  assert.equal(allowedPath(cfg, ".crewbie/team/../../.github/workflows/x.md"), false);
});

test("memory fingerprints survive Git newline conversion but reject actual edits", async (t) => {
  const cfg = config({ nightly: { ...config().nightly, enabled: true } });
  const root = await fixture(t);
  await applyInstallation(root, await installation(root, { config: cfg, constitutionText: null }));
  const original = await memoryContext(root, cfg, "improver");
  for (const file of original) await writeFile(join(root, file.path), file.content.replaceAll("\n", "\r\n"));
  const converted = await memoryContext(root, cfg, "improver");
  assert.deepEqual(converted.map((file) => file.sha256), original.map((file) => file.sha256));
  const evidence = [runRecord(run())];
  const hot = original.find((file) => file.path.endsWith("/hot.md"));
  const proposal = parseProposal({ summary: "Clarify checks.", changes: [{
    path: hot.path, beforeHash: hot.sha256, content: "Run focused checks. Source: PR #1.",
    reason: "Review found a missing check.", evidence: [evidenceId(evidence[0])],
  }] });
  await validateProposal(root, cfg, proposal, evidence);
  await writeFile(join(root, hot.path), hot.content + "A real new lesson.\n");
  await assert.rejects(validateProposal(root, cfg, proposal, evidence), /changed since analysis/);
});

test("usage needs provenance; absent counts are never coerced to zero", () => {
  assert.equal(runRecord(run()).inputTokens, null);
  assert.throws(() => runRecord(run({ inputTokens: 42 })), /evidence source/);
  assert.throws(() => runRecord(run({ observedModel: "claimed" })), /runtime evidence/);
  assert.throws(() => runRecord(run({ inputTokens: -1 })), /non-negative/);
  assert.throws(() => runRecord(run({ inputTokens: 1.5, usageSource: "export" })), /whole/);
  assert.throws(() => parseRecords([run(), run()]), /Duplicate/);
});

test("memory topics are selected from relevant index links, not loaded wholesale", () => {
  const index = "[Regression testing](cold/regression-testing.md)\n[Build system](cold/build-system.md)\n[Regression decision](../../decisions/archive/regression-policy.md)\n[Unsafe](../../secrets.md)";
  assert.deepEqual(relevantTopics(index, "Regression testing feedback"), ["cold/regression-testing.md", "shared/archive/regression-policy.md"]);
  assert.deepEqual(relevantTopics(index, "Unrelated permissions"), []);
});

test("report dates normalize to UTC and duplicate sessions cannot inflate totals", () => {
  assert.equal(runRecord(run({ date: "2026-09-22T09:00:00+02:00" })).date, "2026-09-22T07:00:00.000Z");
  assert.throws(() => parseRecords([
    run({ id: "one", kind: "session", sessionId: "same-session" }),
    run({ id: "two", kind: "session", sessionId: "same-session" }),
  ]), /Duplicate session IDs/);
});

test("dashboard runs offline, filters correctly and shows unknown/mismatched models", () => {
  const html = dashboard([
    runRecord(run()),
    runRecord(run({ id: "2", specialist: "tester", requestedModel: "small", observedModel: "large", observedModelSource: "runtime-export", date: "2026-09-21T07:00:00Z", inputTokens: 10, outputTokens: 20, usageSource: "runtime-export" })),
  ]);
  const dom = new JSDOM(html, { runScripts: "dangerously", beforeParse(window) { window.matchMedia = () => ({ matches: false }); } });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll("#runs tr").length, 2);
  assert.match(doc.querySelector("#coverage").textContent, /1 with both/);
  assert.equal(doc.querySelectorAll(".mismatch").length, 1);
  doc.querySelector("#specialist").value = "developer";
  doc.querySelector("#specialist").dispatchEvent(new dom.window.Event("change"));
  assert.equal(doc.querySelectorAll("#runs tr").length, 1);
  assert.match(doc.querySelector("#usage").textContent, /Unavailable/);
  assert.match(doc.querySelector("#runs").textContent, /Unverified/);
  dom.window.close();
});

test("untrusted report strings cannot escape script data or execute markup", () => {
  const html = dashboard([runRecord(run({ specialist: '</script><script>globalThis.PWNED=1</script>', summary: "<img src=x onerror=alert(1)>" }))]);
  const dom = new JSDOM(html, { runScripts: "dangerously", beforeParse(window) { window.matchMedia = () => ({ matches: true }); } });
  assert.equal(dom.window.PWNED, undefined);
  assert.equal(dom.window.document.querySelectorAll("img").length, 0);
  assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
  dom.window.close();
});
