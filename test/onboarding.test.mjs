import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assess } from "../dist/setup/assessment.js";
import { parseSetupReview, proposeSetup, selectGuidance, setupPrompt } from "../dist/setup/onboarding.js";
import { initCommand, installSetup } from "../dist/setup/init.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { profile } from "../dist/setup/templates.js";
import { setupLabels } from "../dist/tracking/issues.js";
import { config, fixture } from "./helpers.mjs";

function response(assessment, overrides = {}) {
  return {
    summary: "Use a catalogue specialist, reusing current project guidance.",
    findings: [
      ...["instructions", "mcp", "agents", "constitution", "project"].map((area) => ({ area, path: null, assessment: `Reviewed ${area}.`, recommendation: "Preserve useful existing guidance." })),
      ...assessment.inventory.files.filter((file) => file.kind !== "project").map((file) => ({ area: file.kind, path: file.path, assessment: "Existing project constraint.", recommendation: "Reuse rather than duplicate." })),
      ...assessment.inventory.mcp.map((file) => ({ area: "mcp", path: file.path, assessment: "Configured servers; connectivity unverified.", recommendation: "Retain existing integrations." })),
    ],
    questions: [],
    roles: [{ id: "catalogue", purpose: "Own catalogue ordering and pagination.", checks: ["Verify stable ordering and explicit retry after page failure."], nonNegotiables: ["Retain loaded cards after a later page fails."], contextPaths: assessment.inventory.files.filter((file) => file.kind === "agents").map((file) => file.path) }],
    instructions: [], constitutionText: null, ...overrides,
  };
}

test("inventory includes all guidance and agents, sanitizes MCP metadata and never executes it", async (t) => {
  const root = await fixture(t, {
    "AGENTS.md": "Keep persisted catalogue IDs stable.",
    "src/AGENTS.md": "Preserve retry boundaries.",
    ".github/agents/catalogue.agent.md": "Catalogue ownership.",
    ".claude/agents/qa.md": "Catalogue invariants.",
    ".vscode/mcp.json": JSON.stringify({ servers: { data: { command: "MUST-NOT-EXECUTE", args: ["private-arg"], env: { API_TOKEN: "private-credential" }, url: "https://user:password@invalid.example", headers: { Authorization: "private-header" } } } }),
    "src/catalogue.ts": "export const limit = 20;",
  });

  const report = await assess(root);
  assert.equal(report.inventory.mode, "brownfield");
  assert.ok(report.inventory.files.some((file) => file.path === "src/AGENTS.md"));
  assert.equal(report.inventory.files.filter((file) => file.kind === "agents").length, 2);
  assert.equal(report.inventory.mcp[0].servers[0].name, "data");
  assert.deepEqual(report.inventory.mcp[0].servers[0].credentials, ["API_TOKEN"]);
  const prompt = setupPrompt(report, "Catalogue");
  assert.doesNotMatch(prompt, /private-credential|private-arg|private-header|user:password/);
  assert.match(prompt, /connectivity|availability/);
});

test("MCP JSONC comments and trailing commas are assessed; invalid and oversized files are disclosed", async (t) => {
  const root = await fixture(t, {
    ".vscode/mcp.json": '{ // Editor settings\n "servers": {"docs": {"type": "http", "url": "https://example.invalid",},},}',
    ".mcp.json": "{not-json",
    "AGENTS.md": "x".repeat(64_001),
  });
  const report = await assess(root);
  assert.equal(report.inventory.mcp[0].servers[0].name, "docs");
  assert.ok(report.inventory.omitted.some((file) => file.path === ".mcp.json"));
  assert.ok(report.inventory.omitted.some((file) => file.path === "AGENTS.md"));
});

test("init asks the LLM for a domain team and creates no fixed implementation profiles", async (t) => {
  const root = await fixture(t, { "src/domain.ts": "export const catalogue = {};", ".github/agents/domain.agent.md": "Reuse catalogue invariants." });
  const report = await assess(root);
  const proposal = await proposeSetup(report, "", "chosen-model", { analyze: async (prompt) => {
    assert.match(prompt, /smallest useful implementation crew/);
    return JSON.stringify(response(report));
  }, report() {} });
  assert.deepEqual(proposal.config.roles.map((role) => role.id), ["catalogue"]);
  assert.equal(proposal.config.roles[0].model, "chosen-model");
  assert.ok(proposal.config.nightly.allowedPaths.includes(".github/agents/crewbie-catalogue.agent.md"));
  assert.ok(!proposal.config.nightly.allowedPaths.includes(".github/agents/crewbie-developer.agent.md"));
  const changes = await installation(root, proposal);
  assert.ok(changes.some((file) => file.path.endsWith("crewbie-catalogue.agent.md")));
  assert.ok(!changes.some((file) => /crewbie-(developer|tester|reviewer)\.agent\.md/.test(file.path)));
  const charter = profile(proposal.config.roles[0], proposal.config);
  assert.match(charter, /stable ordering/);
  assert.match(charter, /\.github\/agents\/domain\.agent\.md/);
  assert.doesNotMatch(charter, /Trace the changed behavior/);
});

test("greenfield clarification repeats with answers before generating the team", async (t) => {
  const root = await fixture(t);
  const report = await assess(root);
  assert.equal(report.inventory.mode, "greenfield");
  let calls = 0;
  const proposal = await proposeSetup(report, "An app", "chosen-model", {
    analyze: async (prompt) => {
      calls++;
      if (calls === 1) return JSON.stringify(response(report, { questions: ["Who uses it and what should it do?"], roles: [] }));
      assert.match(prompt, /Shoppers browse a React catalogue/);
      return JSON.stringify(response(report));
    },
    ask: async () => "Shoppers browse a React catalogue with stable pagination; no checkout. Preserve cards on errors.",
    report() {},
  });
  assert.equal(calls, 2);
  assert.equal(proposal.status, "ready");
});

test("noninteractive insufficient input persists questions but cannot install guessed roles", async (t) => {
  const root = await fixture(t);
  const report = await assess(root);
  const proposal = await proposeSetup(report, "An app", "chosen-model", {
    analyze: async () => JSON.stringify(response(report, { questions: ["Which users and behavior?"], roles: [] })), report() {},
  });
  assert.equal(proposal.status, "clarification");
  await assert.rejects(installation(root, proposal), /clarification/);
  await assert.rejects(initCommand(root, { model: "chosen-model", description: "An app" }, {
    client() { throw new Error("No remote calls"); }, report() {},
    analyze: async () => JSON.stringify(response(report, { questions: ["Which users and behavior?"], roles: [] })),
  }), /needs clarification/);
  assert.equal(JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8")).status, "clarification");
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});

test("incomplete assessment, invented context and generic team output are rejected", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Local policy." });
  const report = await assess(root);
  const good = response(report);
  assert.throws(() => parseSetupReview(JSON.stringify({ ...good, findings: good.findings.filter((finding) => finding.path !== "AGENTS.md") }), report, "", "chosen-model"), /omitted AGENTS/);
  assert.throws(() => parseSetupReview(JSON.stringify({ ...good, roles: [{ ...good.roles[0], checks: [] }] }), report, "", "chosen-model"), /project-specific checks/);
  assert.throws(() => parseSetupReview(JSON.stringify({ ...good, roles: [{ ...good.roles[0], contextPaths: ["invented.md"] }] }), report, "", "chosen-model"), /not inspected/);
  await assert.rejects(proposeSetup(report, "", "chosen-model", { analyze: async () => { throw new Error("Provider unavailable"); }, report() {} }), /Provider unavailable/);
});

test("reassessment preserves existing models, approvals and policy; retirement is explicit", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config({ maxActive: 1 })) });
  const report = await assess(root);
  const good = response(report);
  assert.throws(() => parseSetupReview(JSON.stringify(good), report, "", "new-model"), /retired an existing role/);
  const proposal = parseSetupReview(JSON.stringify({ ...good, roles: [{ ...good.roles[0], id: "developer", model: "unapproved-model" }, good.roles[0]] }), report, "", "new-model");
  assert.equal(proposal.config.roles[0].model, "approved-model");
  assert.equal(proposal.config.roles[1].model, "new-model");
  assert.equal(proposal.config.maxActive, 1);
  assert.deepEqual(proposal.config.approvers, ["maintainer"]);
});

test("guidance can be skipped independently; approved changes bind to inspected content", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Preserve IDs." });
  const report = await assess(root);
  const proposal = parseSetupReview(JSON.stringify(response(report, {
    instructions: [{ path: "AGENTS.md", content: "Preserve IDs.\nCheck stable catalogue ordering.", reason: "Record the domain invariant." }],
    constitutionText: "Preserve catalogue identity. Humans approve scope and merges.",
  })), report, "Catalogue", "chosen-model");
  const skipped = selectGuidance(proposal, false);
  assert.equal(skipped.config.constitution, null);
  assert.ok(!(await installation(root, skipped)).some((change) => change.path === "AGENTS.md"));
  assert.ok((await installation(root, proposal)).some((change) => change.path === "AGENTS.md"));
  await writeFile(join(root, "AGENTS.md"), "A new human rule.");
  await assert.rejects(installation(root, proposal), /changed since assessment/);
});

test("existing constitution remains referenced in team-only setup", async (t) => {
  const root = await fixture(t, { ".specify/memory/constitution.md": "Existing approved policy." });
  const report = await assess(root);
  const proposal = parseSetupReview(JSON.stringify(response(report)), report, "Catalogue", "chosen-model");
  assert.equal(selectGuidance(proposal, false).config.constitution, ".specify/memory/constitution.md");
  assert.throws(() => parseSetupReview(JSON.stringify(response(report, { constitutionText: "Rewrite policy" })), report, "", "chosen-model"), /Reuse the existing constitution/);
});

function githubLabels() {
  const labels = [{ name: "unrelated", color: "ffffff" }];
  const calls = [];
  return { labels, calls, client: {
    async list() { return labels; },
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/user") return { login: "maintainer", type: "User" };
      if (method === "POST" && path.endsWith("/labels")) { labels.push(body); return body; }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  } };
}

test("init apply creates every label, including planning and dynamic owners, idempotently", async (t) => {
  const root = await fixture(t);
  const proposal = { config: config(), constitutionText: null, instructions: [] };
  const remote = githubLabels();
  const preview = await installSetup(root, proposal, { apply: false, guidance: "skip", skipLabels: false }, remote.client);
  assert.match(preview, /crewbie:ready-for-planning/);
  assert.equal(remote.calls.length, 0);
  await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false }, remote.client);
  const writes = remote.calls.filter((call) => call.method === "POST").length;
  assert.equal(writes, setupLabels(proposal.config).length);
  await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false }, remote.client);
  assert.equal(remote.calls.filter((call) => call.method === "POST").length, writes);
  assert.deepEqual(remote.labels[0], { name: "unrelated", color: "ffffff" });
});

test("label failure reports partial setup and a retry repairs remote state", async (t) => {
  const root = await fixture(t);
  const proposal = { config: config(), constitutionText: null };
  const remote = githubLabels();
  const request = remote.client.request;
  remote.client.request = async (method, path, body) => {
    if (method === "POST") throw new Error("Permission denied");
    return request(method, path, body);
  };
  await assert.rejects(installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false }, remote.client), /Local setup was applied, but GitHub labels are incomplete/);
  assert.ok(await readFile(join(root, ".crewbie/config.json")));
  remote.client.request = request;
  await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false }, remote.client);
});

test("interactive init shows assessment and preview before applying team-only choice", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const value = 1;", "AGENTS.md": "Existing guidance." });
  const report = await assess(root);
  const prompts = [], reports = [];
  const answers = ["team", "yes"];
  const remote = githubLabels();
  await initCommand(root, { model: "chosen-model", repo: "example/project", approver: ["maintainer"] }, {
    analyze: async () => JSON.stringify(response(report, { instructions: [{ path: "AGENTS.md", content: "Proposed change.", reason: "Clarify scope." }] })),
    ask: async (question) => { prompts.push(question); return answers.shift(); },
    client: () => remote.client, report: (text) => reports.push(text),
  });
  assert.equal(prompts.length, 2);
  assert.match(reports[1], /Use a catalogue specialist/);
  assert.ok(reports.some((text) => /"labels"/.test(text)));
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "Existing guidance.");
  const installed = JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8"));
  assert.deepEqual(installed.roles.map((role) => role.id), ["catalogue"]);
  assert.ok(remote.labels.some((label) => label.name === "crewbie:owner:catalogue"));
});

test("new custom-agent guidance changes are hash-checked and generated-profile collisions rejected", async (t) => {
  const root = await fixture(t, { ".github/agents/catalogue.agent.md": "Existing catalogue guidance." });
  const report = await assess(root);
  const proposal = parseSetupReview(JSON.stringify(response(report, {
    instructions: [{ path: ".github/agents/catalogue.agent.md", content: "Existing catalogue guidance.\nPreserve IDs.", reason: "Keep the invariant near ownership." }],
  })), report, "", "chosen-model");
  await applyInstallation(root, await installation(root, proposal));
  assert.match(await readFile(join(root, ".github/agents/catalogue.agent.md"), "utf8"), /Preserve IDs/);
  await writeFile(join(root, ".github/agents/catalogue.agent.md"), proposal.instructions[0].content.replaceAll("\n", "\r\n"));
  assert.deepEqual(await installation(root, proposal), []);
  proposal.instructions[0].path = ".github/agents/crewbie-catalogue.agent.md";
  await assert.rejects(installation(root, proposal), /Unsupported instruction path/);
});

test("real init CLI invokes isolated tool-free Copilot transport and persists its domain team", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const pageSize = 20;" });
  const assessment = await assess(root);
  const fakeScript = `import { readFileSync, existsSync, realpathSync } from "node:fs";
import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
process.chdir(realpathSync(process.cwd()));
const prompt = readFileSync(0, "utf8");
assert.match(prompt, /smallest useful implementation crew/);
assert.match(prompt, /src\\/catalogue.ts/);
assert.ok(process.argv.includes("--available-tools"));
assert.ok(process.argv.includes("--no-custom-instructions"));
assert.ok(process.argv.includes("--no-ask-user"));
assert.equal(process.env.COPILOT_ALLOW_ALL, "false");
assert.equal(process.env.COPILOT_PROVIDER_BASE_URL, undefined);
assert.equal(realpathSync(dirname(process.env.COPILOT_HOME)), realpathSync(process.cwd()));
assert.equal(basename(process.env.COPILOT_HOME), "config");
assert.ok(!existsSync("src"));
console.log(${JSON.stringify(JSON.stringify(response(assessment)))});
`;
  const tools = await fixture(t, {
    "fake-copilot.mjs": fakeScript,
    "copilot.cmd": `@"${process.execPath}" "%~dp0fake-copilot.mjs" %*\r\n`,
    "copilot": `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-copilot.mjs" "$@"\n`,
  });
  if (process.platform !== "win32") {
    const { chmod } = await import("node:fs/promises");
    await chmod(join(tools, "copilot"), 0o755);
  }
  await mkdir(join(tools, "temp-real"));
  const tempAlias = join(tools, "temp-alias");
  await symlink(join(tools, "temp-real"), tempAlias, process.platform === "win32" ? "junction" : "dir");
  const env = { ...process.env, TEMP: tempAlias, TMP: tempAlias, TMPDIR: tempAlias, GH_TOKEN: "fixture-only", COPILOT_GITHUB_TOKEN: "fixture-only", COPILOT_ALLOW_ALL: "true", COPILOT_PROVIDER_BASE_URL: "http://must-not-use.invalid" };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${tools}${process.platform === "win32" ? ";" : ":"}${env[pathKey]}`;
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "init", "--path", root,
    "--model", "chosen-model", "--out", "proposal.json",
  ], { env, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const proposal = JSON.parse(await readFile(join(root, "proposal.json"), "utf8"));
  assert.deepEqual(proposal.config.roles.map((role) => role.id), ["catalogue"]);
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});
