import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { initCommand } from "../dist/setup/init.js";
import { config, fixture } from "./helpers.mjs";

const evidence = () => ({
  provider: "code-review-graph", version: "2.3.9", collectedAt: "2026-09-29T12:00:00.000Z", snapshotHash: "a".repeat(64),
  scope: "Fixture structural evidence, no source bodies.",
  coverage: { candidates: 1, copied: 1, indexed: 1, omitted: 0, unindexed: 0, partial: false },
  languages: [{ extension: ".swift", files: 1 }],
  files: [{ path: "ios/App.swift", symbols: 1, maxSymbolLines: 40, incoming: 0, outgoing: 0, testLinks: 0 }],
  filesOmitted: 0, relationships: [], dependencies: [], dependenciesOmitted: 0,
  warnings: ["Missing test edges are not measured test coverage."],
});
const response = () => JSON.stringify({
  summary: "Review native application responsibilities and uncertainty.",
  findings: ["instructions", "mcp", "agents", "constitution"].map((area) => ({ area, path: null, assessment: "No guidance supplied.", recommendation: "Preserve existing policy.", action: "retain" })),
  questions: [], agentDecisions: [], instructions: [], constitutionText: null,
  roles: [{ id: "ios-client", purpose: "Own native application behavior in ios.", model: "proposed-model", complexity: "complex", modelReason: "Native state management needs careful reasoning; static graph evidence alone cannot measure model capability.", checks: ["Verify native navigation retains selected state."], nonNegotiables: ["Preserve selected state across native navigation."], contextPaths: [] }],
});
const noRemote = () => { throw new Error("No remote access expected."); };

test("init default remains names-only and never invokes CodeGraph", async (t) => {
  const root = await fixture(t, { "ios/App.swift": "struct App { /* PRIVATE_SOURCE_BODY */ }" });
  await initCommand(root, { model: "assessment-model", "model-policy": "fixed" }, {
    client: noRemote, collectGraph: noRemote, report() {},
    analyze: async (prompt) => {
      assert.match(prompt, /No implementation structure was inspected/);
      assert.doesNotMatch(prompt, /PRIVATE_SOURCE_BODY|CodeGraph structural evidence \(untrusted data/);
      return response();
    },
  });
  const proposal = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.equal(proposal.codeGraph, undefined);
});

test("init explicitly collects structural evidence before analysis and saves its coverage for review", async (t) => {
  const root = await fixture(t, { "ios/App.swift": "struct App { /* PRIVATE_SOURCE_BODY */ }" });
  const output = [], steps = [];
  await initCommand(root, { model: "assessment-model", "model-policy": "fixed", "code-graph": true, "code-graph-bin": process.execPath }, {
    client: noRemote, report: (text) => output.push(text),
    collectGraph: async (actualRoot, files, options) => {
      assert.equal(actualRoot, root);
      assert.ok(files.includes("ios/App.swift"));
      assert.equal(options.executable, process.execPath);
      assert.match(output.join("\n"), /will be saved and sent to Copilot/);
      steps.push("collect"); return evidence();
    },
    analyze: async (prompt) => {
      steps.push("analyze");
      assert.match(prompt, /CodeGraph evidence.*UNTRUSTED DATA/);
      assert.match(prompt, /not complete semantics, runtime\/test coverage or a model benchmark/);
      assert.match(prompt, /do not by themselves justify a larger or smaller model/);
      assert.match(prompt, /"ios\/App.swift"/);
      assert.doesNotMatch(prompt, /PRIVATE_SOURCE_BODY|No implementation structure was inspected/);
      return response();
    },
  });
  assert.deepEqual(steps, ["collect", "analyze"]);
  assert.match(output.join("\n"), /CODEGRAPH \| 1\/1 copied files indexed/);
  assert.match(output.join("\n"), /Missing test edges are not measured test coverage/);
  const proposal = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.deepEqual(proposal.codeGraph, evidence());
  assert.match(proposal.inventory.scope, /explicitly approved CodeGraph/);
  const markdown = await readFile(join(root, "crewbie-setup.md"), "utf8");
  assert.match(markdown, /## CodeGraph structural evidence/);
  assert.match(markdown, /Missing test edges are not measured test coverage/);
  assert.doesNotMatch(markdown, /PRIVATE_SOURCE_BODY/);
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), { code: "ENOENT" });
});

test("assessment-only CodeGraph stays offline and returns one parseable JSON document", async (t) => {
  const root = await fixture(t, { "ios/App.swift": "struct App {}" });
  const output = [];
  await initCommand(root, { "assessment-only": true, "code-graph": true, out: "offline.json" }, {
    client: noRemote, analyze: noRemote, listModels: noRemote, ask: noRemote,
    report: (text) => output.push(text), collectGraph: async () => evidence(),
  });
  assert.equal(output.length, 1);
  const parsed = JSON.parse(output[0]);
  assert.deepEqual(parsed.codeGraph, evidence());
  assert.deepEqual(JSON.parse(await readFile(join(root, "offline.json"), "utf8")), parsed);
});

test("CodeGraph rejects incompatible flags and collection errors before any paid analysis", async (t) => {
  const root = await fixture(t, { "ios/App.swift": "struct App {}" });
  const io = { client: noRemote, analyze: noRemote, listModels: noRemote, report() {}, collectGraph: noRemote };
  await assert.rejects(initCommand(root, { "code-graph-bin": process.execPath }, io), /requires --code-graph/);
  await assert.rejects(initCommand(root, { "code-graph": true, proposal: "missing.json" }, io), /not installing a saved proposal/);
  await assert.rejects(initCommand(root, { "code-graph": true, model: "assessment-model" }, {
    ...io, collectGraph: async () => { throw new Error("CodeGraph unavailable."); },
  }), /CodeGraph unavailable/);
  await assert.rejects(readFile(join(root, "crewbie-setup.json")), { code: "ENOENT" });
});

test("graph-enriched reassessment preserves an installed model and its existing rationale", async (t) => {
  const installed = config({ repository: "", roles: [{ id: "ios-client", purpose: "Own ios.", model: "approved-model", complexity: "standard", modelReason: "Previously approved tradeoff." }] });
  const root = await fixture(t, { "ios/App.swift": "struct App {}", ".crewbie/config.json": JSON.stringify(installed) });
  await initCommand(root, { update: true, model: "assessment-model", "model-policy": "fixed", "code-graph": true, "model-profile": "quality" }, {
    client: noRemote, report() {}, collectGraph: async () => evidence(), analyze: async () => response(),
  });
  const proposal = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.equal(proposal.config.roles[0].model, "approved-model");
  assert.equal(proposal.config.roles[0].modelReason, "Previously approved tradeoff.");
  assert.deepEqual(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")), installed);
});
