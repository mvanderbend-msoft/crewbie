import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assess } from "../dist/setup/assessment.js";
import { parseSetupReview, proposeSetup, selectGuidance, setupPrompt } from "../dist/setup/onboarding.js";
import { initCommand as runInit, installSetup } from "../dist/setup/init.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { profile } from "../dist/setup/templates.js";
import { setupLabels } from "../dist/tracking/issues.js";
import { config, fixture } from "./helpers.mjs";
import { GitHubError } from "../dist/core.js";

const initCommand = (root, options, io) => runInit(root, { "model-policy": "fixed", ...options }, io);

test("economy, balanced and quality profiles persist reviewed choices with a non-code capability floor", async (t) => {
  for (const profile of ["economy", "balanced", "quality"]) {
    const root = await fixture(t, { "src/catalogue.ts": "export const catalogue = {};" });
    const assessment = await assess(root);
    await runInit(root, { model: "assessment-model", "model-profile": profile, out: "team.json" }, {
      client() { throw new Error("No remote writes"); }, report() {},
      listModels: async () => [{ id: "capable-model", name: "Capable" }],
      analyze: async (prompt) => {
        assert.match(prompt, new RegExp(`Model-selection profile: ${profile}`));
        assert.match(prompt, /Never downgrade quality-sensitive work merely because it is non-code/);
        assert.match(prompt, /No automatic model fallback or paid rerun/);
        const value = response(assessment);
        Object.assign(value.roles[0], { model: "capable-model", complexity: "complex", modelReason: "Complex invariant reasoning needs a capable model; review its price tradeoff." });
        return JSON.stringify(value);
      },
    });
    const proposal = JSON.parse(await readFile(join(root, "team.json"), "utf8"));
    assert.equal(proposal.config.modelProfile, profile);
    assert.equal(proposal.config.roles[0].model, "capable-model");
    assert.deepEqual(proposal.config.execution, { maxLaunchesPerBatch: 20, maxAttemptsPerTask: 3 });
  }
});

test("installation previews explain the purpose and ownership of every proposed file without extra templates", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const catalogue = {};" });
  const assessment = await assess(root);
  const proposal = parseSetupReview(JSON.stringify(response(assessment)), assessment, "", "chosen-model");
  const preview = JSON.parse(await installSetup(root, proposal, { apply: false, guidance: "skip", skipLabels: true, json: true }));
  assert.ok(preview.files.length > 0);
  assert.ok(preview.files.every((file) => file.ownership && file.purpose));
  assert.equal(preview.files.find((file) => file.path === ".crewbie/config.json").ownership, "User policy");
  assert.equal(preview.files.find((file) => file.path.endsWith("/hot.md")).ownership, "User knowledge");
  assert.ok(preview.files.every((file) => !file.path.includes("/templates/")));
  assert.match(await installSetup(root, proposal, { apply: false, guidance: "skip", skipLabels: true }), /edited workflows block update/);
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});

function response(assessment, overrides = {}) {
  return {
    summary: "Use a catalogue specialist, reusing current project guidance.",
    findings: [
      ...["instructions", "mcp", "agents", "constitution"].map((area) => ({ area, path: null, assessment: `Reviewed ${area}.`, recommendation: "Preserve useful existing guidance.", action: "retain" })),
      ...assessment.inventory.files.filter((file) => file.kind !== "archive").map((file) => ({ area: file.kind, path: file.path, assessment: "Existing project constraint.", recommendation: "Reuse rather than duplicate.", action: "retain" })),
      ...assessment.inventory.mcp.map((file) => ({ area: "mcp", path: file.path, assessment: "Configured servers; connectivity unverified.", recommendation: "Retain existing integrations.", action: "retain" })),
    ],
    questions: [],
    agentDecisions: assessment.inventory.files.filter((file) => /^(?:\.github|\.claude)\/agents\/(?!crewbie-)/.test(file.path) && !file.redacted)
      .map((file) => ({ path: file.path, action: "retain", reason: "Keep this existing specialist unchanged." })),
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
    assert.match(prompt, /project-specific implementation crew/);
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

test("empty and truncated Copilot responses produce actionable errors, not raw JSON exceptions", async (t) => {
  const report = await assess(await fixture(t));
  assert.throws(() => parseSetupReview("", report, "Catalogue", "chosen-model"), /Copilot returned no assessment/);
  assert.throws(() => parseSetupReview('{"summary":', report, "Catalogue", "chosen-model"), /incomplete or invalid JSON/);
});

test("assessment accepts harmless path spelling variants only for inspected Markdown guidance", async (t) => {
  const report = await assess(await fixture(t, { ".github/agents/catalogue.agent.md": "Catalogue constraints." }));
  for (const path of [".\\.github\\agents\\catalogue.agent.md", "./.github/agents/catalogue.agent.md"]) {
    const review = response(report);
    review.roles[0].contextPaths = [path];
    const proposal = parseSetupReview(JSON.stringify(review), report, "", "chosen-model");
    assert.deepEqual(proposal.config.roles[0].contextPaths, [".github/agents/catalogue.agent.md"]);
  }
});

test("invalid role context identifies the specialist and offending path", async (t) => {
  const report = await assess(await fixture(t, { "src/catalogue.ts": "export const pageSize = 20;" }));
  const review = response(report);
  review.roles[0].contextPaths = ["src/catalogue.ts"];
  assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "chosen-model"), /catalogue.*src\/catalogue\.ts.*Markdown/);
});

test("slow assessment reports elapsed wait and validation without exposing model output", async (t) => {
  const report = await assess(await fixture(t));
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const messages = [];
  let complete;
  const pending = proposeSetup(report, "Catalogue", "chosen-model", {
    analyze: () => new Promise((resolve) => { complete = resolve; }),
    report: (message) => messages.push(message),
  });
  let duringWait;
  try {
    t.mock.timers.tick(15_000);
    duringWait = [...messages];
  } finally {
    complete(JSON.stringify(response(report)));
    await pending;
  }
  assert.ok(duringWait.some((message) => /analysing.*15s/.test(message)));
  assert.ok(messages.some((message) => /validating/i.test(message)));
  const after = messages.length;
  t.mock.timers.tick(30_000);
  assert.equal(messages.length, after);
});

test("prompt and parser share the exact eligible Markdown context list", async (t) => {
  const report = await assess(await fixture(t, {
    "docs/decisions/Team Guide.MD": "Preserve order identities.",
    "AGENTS.md": "Keep retries explicit.",
    "src/catalogue.ts": "export const pageSize = 20;",
    ".github/agents/private.agent.md": "api_key=sk-abcdefghijklmnopqrstuvwxyz",
    ".vscode/mcp.json": '{"servers":{}}',
  }));
  const prompt = setupPrompt(report, "");
  const allowed = JSON.parse(prompt.match(/allowedContextPaths: (\[[\s\S]*?\])/)[1]);
  assert.deepEqual(new Set(allowed), new Set(["AGENTS.md"]), "Project docs such as ADRs are not AI guidance context.");
  assert.match(prompt, /at most ten entries/);
  assert.match(prompt, /Source code and MCP configuration.*NOT contextPaths/);
  const review = response(report);
  review.roles[0].contextPaths = allowed;
  const proposal = parseSetupReview(JSON.stringify(review), report, "", "chosen-model");
  assert.deepEqual(proposal.config.roles[0].contextPaths, allowed);
  assert.doesNotMatch(profile(proposal.config.roles[0], proposal.config), /AGENTS\.md/, "Copilot already attaches AGENTS.md");
  assert.doesNotMatch(profile(proposal.config.roles[0], proposal.config), /Team Guide/);
});

test("unsafe, invented, omitted and redacted context paths cannot be normalized into accepted links", async (t) => {
  const report = await assess(await fixture(t, {
    "AGENTS.md": "Keep retries explicit.",
    ".github/agents/private.agent.md": "api_key=sk-abcdefghijklmnopqrstuvwxyz",
    "src/AGENTS.md": "x".repeat(64_001),
  }));
  for (const path of ["../AGENTS.md", "folder/../AGENTS.md", "/AGENTS.md", "C:\\AGENTS.md",
    "\\\\server\\AGENTS.md", "https://example.invalid/AGENTS.md", "**/AGENTS.md", "AGENTS.md:12",
    ".git/config.md", "missing.md", "src/AGENTS.md", ".github/agents/private.agent.md"]) {
    const review = response(report);
    review.roles[0].contextPaths = [path];
    assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "chosen-model"), /context was not inspected/);
  }
});

test("interactive init repairs rejected context links locally without another assessment", async (t) => {
  const root = await fixture(t, {
    "AGENTS.md": "Keep retries explicit.",
    "src/catalogue.ts": "export const pageSize = 20;",
  });
  const report = await assess(root);
  const review = response(report);
  review.roles[0].contextPaths = ["AGENTS.md", "src/catalogue.ts"];
  const answers = ["99", "1", "save"], messages = [];
  let calls = 0;
  await initCommand(root, { model: "chosen-model" }, {
    analyze: async () => { calls++; return JSON.stringify(review); },
    ask: async () => { assert.ok(answers.length); return answers.shift(); },
    report: (message) => messages.push(message),
    client() { throw new Error("No GitHub writes"); },
  });
  assert.equal(calls, 1);
  assert.ok(messages.some((message) => /src\/catalogue.ts.*Markdown/.test(message)));
  assert.ok(messages.some((message) => /Invalid selection/.test(message)));
  assert.ok(messages.some((message) => /Continuing validation without another AI request/.test(message)));
  const proposal = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.deepEqual(proposal.config.roles[0].contextPaths, ["AGENTS.md"]);
  assert.equal(proposal.review.summary, review.summary);
  assert.equal(proposal.config.roles[0].model, "chosen-model");
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});

test("removing rejected links requires explicit consent and cancelling leaves no setup", async (t) => {
  for (const answer of ["none", "cancel"]) {
    const root = await fixture(t, { "src/catalogue.ts": "export const pageSize = 20;" });
    const report = await assess(root);
    const review = response(report);
    review.roles[0].contextPaths = ["src/catalogue.ts"];
    let calls = 0;
    const pending = initCommand(root, { model: "chosen-model" }, {
      analyze: async () => { calls++; return JSON.stringify(review); },
      ask: async (question) => question.startsWith("Replace rejected") ? answer : "save",
      report() {}, client() { throw new Error("No GitHub writes"); },
    });
    if (answer === "cancel") {
      await assert.rejects(pending, /cancelled during context-link review/);
      await assert.rejects(readFile(join(root, "crewbie-setup.json")), /ENOENT/);
    } else {
      await pending;
      assert.deepEqual(JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8")).config.roles[0].contextPaths, []);
    }
    assert.equal(calls, 1);
  }
});

test("edits outside AI guidance become deferred recommendations, and the prompt forbids pointers to auto-loaded scoped files", async (t) => {
  const report = await assess(await fixture(t, { "AGENTS.md": "Keep catalogue IDs stable." }));
  const prompt = setupPrompt(report, "Catalogue");
  assert.match(prompt, /applyTo globs.*Never add pointers/s);
  assert.match(prompt, /NOT supplied; do not review, request, or propose changes/);
  const base = response(report);
  const review = response(report, {
    findings: [...base.findings, { area: "project", path: "README.md", assessment: "Stale setup notes.", recommendation: "Rewrite README.", action: "edit", editPaths: ["README.md"] }],
    instructions: [{ path: "README.md", content: "# New readme\n", reason: "Refresh." }],
  });
  const proposal = parseSetupReview(JSON.stringify(review), report, "", "model");
  assert.deepEqual(proposal.instructions, []);
  const deferred = proposal.review.findings.find((finding) => finding.path === "README.md");
  assert.equal(deferred.action, "defer");
  assert.equal(deferred.editPaths, undefined);
  assert.match(deferred.deferReason, /outside the AI guidance/);
});

test("progress timers stop after provider failures as well as successful responses", async (t) => {
  const report = await assess(await fixture(t));
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const messages = [];
  await assert.rejects(proposeSetup(report, "", "chosen-model", {
    analyze: async () => { throw new Error("Provider unavailable"); },
    report: (message) => messages.push(message),
  }), /Provider unavailable/);
  t.mock.timers.tick(30_000);
  assert.equal(messages.filter((message) => message.includes("Still analysing")).length, 0);
});

test("oversized context lists fail before offering an impossible repair", async (t) => {
  const report = await assess(await fixture(t, { "AGENTS.md": "Keep retries explicit." }));
  const review = response(report);
  review.roles[0].contextPaths = [...Array(11).fill("AGENTS.md"), "src/catalogue.ts"];
  await assert.rejects(proposeSetup(report, "", "chosen-model", {
    analyze: async () => JSON.stringify(review),
    ask: async () => { throw new Error("Must not offer unrepairable context choices"); },
    report() {},
  }), /catalogue contextPaths.*at most ten/);
});

test("init gives every crew a PR reviewer: the proposed role, else a review specialist, and keeps an installed choice", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const catalogue = {};" });
  const report = await assess(root);
  const good = response(report);
  const tester = { ...good.roles[0], id: "release-reviewer" };
  assert.match(setupPrompt(report, ""), /Set reviewer to the id of one proposed role/);
  assert.deepEqual(parseSetupReview(JSON.stringify(good), report, "", "m").config.review, { enabled: true, role: good.roles[0].id });
  assert.deepEqual(parseSetupReview(JSON.stringify({ ...good, roles: [good.roles[0], tester] }), report, "", "m").config.review, { enabled: true, role: "release-reviewer" });
  assert.deepEqual(parseSetupReview(JSON.stringify({ ...good, reviewer: good.roles[0].id, roles: [good.roles[0], tester] }), report, "", "m").config.review, { enabled: true, role: good.roles[0].id });
  const installed = await fixture(t, { ".crewbie/config.json": JSON.stringify(config({ review: { enabled: false, role: "developer" } })) });
  const again = await assess(installed);
  const kept = response(again);
  assert.deepEqual(parseSetupReview(JSON.stringify({ ...kept, roles: [{ ...kept.roles[0], id: "developer" }] }), again, "", "m").config.review, { enabled: false, role: "developer" });
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
  assert.equal("approvers" in proposal.config, false);
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
      if (method === "POST" && path.endsWith("/tasks") && body?.base_ref === "crewbie/model-check-never-exists") throw new GitHubError(412, null);
      calls.push({ method, path, body });
      if (method === "GET" && path === "/user") return { login: "maintainer", type: "User" };
      if (method === "GET" && path.includes("/collaborators/")) return { permission: "write" };
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

test("planning install sets a missing Copilot CLI version and never overwrites an existing one", async (t) => {
  const root = await fixture(t);
  const proposal = { config: config({ planning: { enabled: true, model: "planner", executeOnMerge: true } }), constitutionText: null, instructions: [] };
  const remote = githubLabels(), variables = {};
  const request = remote.client.request;
  remote.client.request = async (method, path, body) => {
    const name = path.match(/\/actions\/variables\/(.+)$/)?.[1];
    if (method === "GET" && name) { if (!variables[name]) throw new GitHubError(404, null); return { value: variables[name] }; }
    if (method === "POST" && path.endsWith("/actions/variables")) { variables[body.name] = body.value; return null; }
    return request(method, path, body);
  };
  await assert.rejects(installSetup(root, proposal, { apply: false, guidance: "skip", skipLabels: false, copilotVersion: "latest" }), /must be exact/);
  const missing = await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false }, remote.client);
  assert.match(missing, /gh variable set CREWBIE_COPILOT_VERSION --repo example\/project/);
  assert.match(await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false, copilotVersion: "1.0.88" }, remote.client), /set to 1\.0\.88/);
  assert.match(await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: false, copilotVersion: "1.0.99" }, remote.client), /uses Copilot CLI 1\.0\.88/);
  assert.equal(variables.CREWBIE_COPILOT_VERSION, "1.0.88");
});

test("interactive init shows assessment and preview before applying team-only choice", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const value = 1;", "AGENTS.md": "Existing guidance." });
  const report = await assess(root);
  const prompts = [], reports = [];
  const answers = ["team", "no", "yes"];
  const remote = githubLabels();
  await initCommand(root, { model: "chosen-model", repo: "example/project" }, {
    analyze: async () => JSON.stringify(response(report, { instructions: [{ path: "AGENTS.md", content: "Proposed change.", reason: "Clarify scope." }] })),
    ask: async (question) => { prompts.push(question); return answers.shift(); },
    client: () => remote.client, report: (text) => reports.push(text),
  });
  assert.equal(prompts.length, 3);
  assert.ok(reports.some((text) => /Specialist catalogue/.test(text)));
  assert.ok(reports.some((text) => /workflow and specialist labels/.test(text)));
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "Existing guidance.");
  const installed = JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8"));
  assert.deepEqual(installed.roles.map((role) => role.id), ["catalogue"]);
  assert.ok(remote.labels.some((label) => label.name === "crewbie:owner:catalogue"));
});

test("interactive init with hosted planning asks for a missing Copilot CLI version and sets it", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const value = 1;", "AGENTS.md": "Existing guidance." });
  const report = await assess(root);
  const prompts = [], answers = ["team", "yes", "", "yes"], variables = {};
  const remote = githubLabels();
  const request = remote.client.request;
  remote.client.request = async (method, path, body) => {
    if (method === "GET" && path.endsWith("/actions/variables/CREWBIE_COPILOT_VERSION")) {
      if (!variables.CREWBIE_COPILOT_VERSION) throw new GitHubError(404, null);
      return { value: variables.CREWBIE_COPILOT_VERSION };
    }
    if (method === "POST" && path.endsWith("/actions/variables")) { variables[body.name] = body.value; return null; }
    return request(method, path, body);
  };
  await initCommand(root, { model: "chosen-model", repo: "example/project" }, {
    analyze: async () => JSON.stringify(response(report)),
    ask: async (question) => { prompts.push(question); return answers.shift(); },
    latestCopilotVersion: async () => "1.0.88",
    client: () => remote.client, report: () => {},
  });
  assert.ok(prompts.some((question) => /Copilot CLI version.*1\.0\.88/.test(question)));
  assert.equal(variables.CREWBIE_COPILOT_VERSION, "1.0.88");
});

test("adopted agents become Crewbie specialists and originals are archived, not duplicated", async (t) => {
  const sourcePath = ".github/agents/frontend-engineer.agent.md";
  const original = "---\nname: Frontend Engineer\ndescription: Accessibility advisor with read-only professional boundaries.\ntools: [read, search]\nmodel: original-model\n---\nPreserve accessible cart interactions. Keep implementation read-only.\n";
  const root = await fixture(t, { [sourcePath]: original });
  const report = await assess(root);
  const review = response(report, {
    roles: [{ id: "frontend-engineer", purpose: "Own frontend behavior.", checks: ["Check cart keyboard behavior."],
      nonNegotiables: ["Keep implementation read-only."], contextPaths: [sourcePath], sourceAgent: sourcePath }],
    agentDecisions: [{ path: sourcePath, action: "adopt", reason: "Existing frontend expertise matches the project." }],
  });
  const proposal = parseSetupReview(JSON.stringify(review), report, "", "chosen-model");
  await applyInstallation(root, await installation(root, proposal));
  assert.equal(await readFile(join(root, ".crewbie/agent-archive/github/agents/frontend-engineer.agent.md"), "utf8"), original);
  await assert.rejects(readFile(join(root, sourcePath)), /ENOENT/);
  const charter = await readFile(join(root, ".github/agents/crewbie-frontend-engineer.agent.md"), "utf8");
  assert.match(charter, /tools:.*read/);
  assert.match(charter, /description: Accessibility advisor with read-only professional boundaries/);
  assert.match(charter, /model: chosen-model/);
  assert.doesNotMatch(charter, /Before any task, read the complete original charter/);
  assert.ok(charter.includes(original.split("---\n").at(-1)), "The complete original instructions belong in the active charter.");
  assert.doesNotMatch(charter, /\bedit\b|\bexecute\b/);
  assert.match(charter, /agent-archive\/github\/agents\/frontend-engineer.agent.md/);
  assert.match(charter, /define a persona or voice, write every PR description/);
  assert.deepEqual(await installation(root, proposal), []);
});

test("four existing specialists can be adopted while concurrency stays at two", async (t) => {
  const ids = ["frontend-engineer", "backend-engineer", "behavior-tester", "release-reviewer"];
  const files = Object.fromEntries(ids.map((id) => [`.github/agents/${id}.agent.md`,
    `---\nname: ${id}\ntools: [read, search]\nhandoffs:\n  - agent: backend-engineer\n    label: Backend\n    prompt: Review API contracts.\n---\nKeep the ${id} domain boundaries.\n`]));
  const root = await fixture(t, files), report = await assess(root);
  const review = response(report, {
    roles: ids.map((id) => ({ id, sourceAgent: `.github/agents/${id}.agent.md`, purpose: `Own ${id} work.`,
      checks: ["Verify the affected domain behavior."], nonNegotiables: ["Preserve existing boundaries."], contextPaths: [] })),
    agentDecisions: ids.map((id) => ({ path: `.github/agents/${id}.agent.md`, action: "adopt", reason: "Reuse existing expertise." })),
  });
  const proposal = parseSetupReview(JSON.stringify(review), report, "", "chosen-model");
  assert.equal(proposal.config.maxActive, 2);
  assert.equal(proposal.config.roles.length, 4);
  await applyInstallation(root, await installation(root, proposal));
  assert.match(await readFile(join(root, ".github/agents/crewbie-frontend-engineer.agent.md"), "utf8"), /agent: crewbie-backend-engineer/);
  const reassessment = await assess(root);
  const refreshed = parseSetupReview(JSON.stringify(response(reassessment, { roles: proposal.config.roles })), reassessment, "", "another-model");
  assert.equal(refreshed.config.roles[0].model, "chosen-model");
  assert.deepEqual(await installation(root, refreshed), []);
});

test("agent adoption refuses edited originals, archive collisions and duplicate ownership", async (t) => {
  const path = ".github/agents/frontend-engineer.agent.md";
  const root = await fixture(t, { [path]: "Preserve accessibility." }), report = await assess(root);
  const review = response(report, {
    roles: [{ id: "frontend", sourceAgent: path, purpose: "Own frontend behavior.", checks: ["Verify keyboard input."], nonNegotiables: ["Preserve accessibility."], contextPaths: [] }],
    agentDecisions: [{ path, action: "adopt", reason: "Reuse frontend expertise." }],
  });
  const proposal = parseSetupReview(JSON.stringify(review), report, "", "chosen-model");
  await writeFile(join(root, path), "A newer human boundary.");
  await assert.rejects(installation(root, proposal), /Agent changed since assessment/);
  assert.equal(await readFile(join(root, path), "utf8"), "A newer human boundary.");
  const conflict = await fixture(t, { [path]: "Preserve accessibility.",
    ".crewbie/agent-archive/github/agents/frontend-engineer.agent.md": "A different archived original." });
  await assert.rejects(installation(conflict, proposal), /Agent changed since assessment/);
  review.roles.push({ ...review.roles[0], id: "another-frontend" });
  assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "chosen-model"), /only one Crewbie specialist/);
});

test("agent decisions must match the adopted roster and account for every existing candidate", async (t) => {
  const root = await fixture(t, { ".github/agents/frontend-engineer.agent.md": "Preserve accessibility." });
  const report = await assess(root), review = response(report);
  assert.throws(() => parseSetupReview(JSON.stringify({ ...review, agentDecisions: [] }), report, "", "chosen-model"), /every existing agent/);
  assert.throws(() => parseSetupReview(JSON.stringify({ ...review, agentDecisions: [{ ...review.agentDecisions[0], action: "adopt" }] }), report, "", "chosen-model"), /does not match/);
});
test("init writes a readable assessment and applies the actual approved instruction edits", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Preserve IDs.", "src/catalogue.ts": "export const pageSize = 20;" });
  const report = await assess(root), messages = [];
  await initCommand(root, { model: "chosen-model", "skip-labels": true }, {
    analyze: async () => JSON.stringify(response(report, { instructions: [{ path: "AGENTS.md", content: "Preserve IDs.\nKeep retries explicit.", reason: "Clarify retry ownership." }] })),
    ask: async (question) => question.startsWith("Install") ? "all" : question.startsWith("Enable") ? "no" : "yes",
    report: (message) => messages.push(message), client() { throw new Error("No GitHub writes"); },
  });
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "Preserve IDs.\nKeep retries explicit.");
  const markdown = await readFile(join(root, "crewbie-setup.md"), "utf8");
  assert.match(markdown, /# Crewbie assessment/);
  assert.match(markdown, /Clarify retry ownership/);
  assert.match(markdown, /AGENTS.md/);
  assert.ok(messages.every((message) => !message.includes('"after":')));
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

test("init explicitly opts into hosted planning and does not discard skipped guidance proposals", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Preserve IDs.", "src/catalogue.ts": "export const pageSize = 20;" });
  const report = await assess(root);
  await initCommand(root, { model: "chosen-model", "skip-labels": true }, {
    analyze: async () => JSON.stringify(response(report, { instructions: [{ path: "AGENTS.md", content: "Preserve IDs.\nKeep retries explicit.", reason: "Clarify retries." }] })),
    ask: async (question) => question.startsWith("Install") ? "team" : "yes",
    report() {}, client() { throw new Error("No GitHub writes"); },
  });
  const installed = JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8"));
  assert.deepEqual(installed.planning, { enabled: true, model: "chosen-model", executeOnMerge: true });
  assert.match(await readFile(join(root, ".github/workflows/crewbie-plan.yml"), "utf8"), /issues:\s+types: \[labeled\]/);
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "Preserve IDs.");
  const saved = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.equal(saved.instructions.length, 1);
  await installSetup(root, saved, { apply: true, guidance: "apply", skipLabels: true });
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /Keep retries explicit/);
});
test("interactive model menu uses live choices and reprompts invalid entries", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const pageSize = 20;" });
  const assessment = await assess(root);
  const answers = ["auto", "99", "2", "save"], reports = [];
  let discovery = 0;
  await initCommand(root, {}, {
    client() { throw new Error("No GitHub writes"); },
    listModels: async () => { discovery++; return [{ id: "first", name: "First model" }, { id: "second", name: "Second model", multiplier: 2 }]; },
    ask: async () => { assert.ok(answers.length); return answers.shift(); },
    report: (text) => reports.push(text),
    analyze: async (_prompt, model) => { assert.equal(model, "second"); return JSON.stringify(response(assessment)); },
  });
  assert.equal(discovery, 1);
  assert.ok(reports.some((text) => /1\. First model \(first\)[\s\S]*2\. Second model \(second\).*2x/.test(text)));
  assert.equal(reports.filter((text) => /Invalid choice/.test(text)).length, 2);
  const proposal = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.equal(proposal.config.roles[0].model, "second");
});

test("explicit model and offline inventory bypass model discovery", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export const pageSize = 20;" });
  const assessment = await assess(root);
  const io = {
    client() { throw new Error("No GitHub writes"); },
    listModels() { throw new Error("Must not discover models"); },
    report() {},
    analyze: async (_prompt, model) => { assert.equal(model, "explicit-model"); return JSON.stringify(response(assessment)); },
  };
  await initCommand(root, { model: "explicit-model" }, io);
  await initCommand(root, { "assessment-only": true }, { ...io, analyze() { throw new Error("Offline"); }, ask() { throw new Error("Offline"); } });
});

test("model discovery failure, empty catalogue and cancellation do not create a proposal", async (t) => {
  for (const [listModels, answer, expected] of [
    [async () => { throw new Error("Discovery unavailable"); }, "", /Discovery unavailable/],
    [async () => [], "", /No available models/],
    [async () => [{ id: "chosen", name: "Chosen" }], "q", /Setup cancelled/],
  ]) {
    const root = await fixture(t, { "src/catalogue.ts": "export const pageSize = 20;" });
    await assert.rejects(initCommand(root, {}, {
      listModels, ask: async () => answer, report() {},
      analyze() { throw new Error("Must not assess"); },
      client() { throw new Error("Must not write"); },
    }), expected);
    await assert.rejects(readFile(join(root, "crewbie-setup.json")), /ENOENT/);
  }
});

test("cost-aware init proposes catalog models by role complexity and preserves installed choices", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config()), "src/catalogue.ts": "export const pageSize = 20;" });
  const report = await assess(root);
  const models = [
    { id: "efficient", name: "Efficient", tokenPrices: { inputPrice: 1, outputPrice: 2, batchSize: 1000000 } },
    { id: "reasoning", name: "Reasoning", multiplier: 3 },
  ];
  const proposed = response(report, { roles: [
    { ...report.installedRoles[0], model: "efficient", checks: ["Check existing behavior."], nonNegotiables: ["Preserve approved scope."] },
    { id: "catalogue", purpose: "Own bounded catalogue changes.", model: "efficient", complexity: "routine", modelReason: "Narrow component changes fit the lower reported token prices.", checks: ["Preserve stable ordering."], nonNegotiables: ["Preserve IDs."] },
    { id: "integration", purpose: "Review cross-system consistency.", model: "reasoning", complexity: "complex", modelReason: "Cross-system failure reasoning warrants the stronger proposed model.", checks: ["Trace transactional boundaries."], nonNegotiables: ["Preserve data."] },
  ] });
  let calls = 0;
  await initCommand(root, { model: "assessment-model", "model-policy": "cost-aware" }, {
    listModels: async () => models, client() { throw new Error("No writes"); }, report() {},
    analyze: async (prompt) => { calls++; assert.match(prompt, /Account catalog:.*inputPrice/s); return JSON.stringify(proposed); },
  });
  assert.equal(calls, 1);
  const result = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.deepEqual(result.config.roles.map((role) => role.model), ["approved-model", "efficient", "reasoning"]);
  assert.match(await readFile(join(root, "crewbie-setup.md"), "utf8"), /Model proposal \(complex\)/);
  proposed.roles[1].model = "invented";
  assert.throws(() => parseSetupReview(JSON.stringify(proposed), report, "", "assessment-model", models), /not in the inspected account catalog/);
});

test("init reassesses without chosen models the cloud agent rejects and warns about installed ones", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config()), "src/catalogue.ts": "export const pageSize = 20;" });
  const report = await assess(root);
  const models = [{ id: "efficient", name: "Efficient" }, { id: "cli-only", name: "CLI only" }];
  const role = (model) => ({ id: "catalogue", purpose: "Own bounded catalogue changes.", model, complexity: "routine", modelReason: "Narrow component changes fit this model.", checks: ["Preserve stable ordering."], nonNegotiables: ["Preserve IDs."] });
  const installed = { ...report.installedRoles[0], checks: ["Check existing behavior."], nonNegotiables: ["Preserve approved scope."] };
  const checks = [], reports = [], prompts = [];
  const client = { async request(method, path, body) {
    assert.equal(body.base_ref, "crewbie/model-check-never-exists");
    checks.push(body.model);
    throw new GitHubError(["cli-only", "approved-model"].includes(body.model) ? 400 : 412, null);
  } };
  await initCommand(root, { model: "assessment-model", "model-policy": "cost-aware" }, {
    listModels: async () => models, client: () => client, report: (text) => reports.push(text),
    analyze: async (prompt) => { prompts.push(prompt); return JSON.stringify(response(report, { roles: [installed, role(prompts.length === 1 ? "cli-only" : "efficient")] })); },
  });
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[1], /cli-only/);
  assert.deepEqual(checks.sort(), ["approved-model", "cli-only", "efficient"], "Each chosen model is checked once.");
  const result = JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8"));
  assert.deepEqual(result.config.roles.map((item) => item.model), ["approved-model", "efficient"]);
  assert.match(reports.join("\n"), /rejects cli-only .*Reassessing without it/);
  assert.match(reports.join("\n"), /rejects installed model approved-model/);
});

test("approved scoped guidance splits replace existing text while team-only keeps it intact", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Shared policy.\nFrontend: preserve accessible names.", "frontend/view.ts": "export {};" });
  const report = await assess(root);
  const changes = [
    { path: "AGENTS.md", content: "Shared policy.\nFor frontend work, read frontend/AGENTS.md.", reason: "Move domain-only guidance out of shared context." },
    { path: "frontend/AGENTS.md", content: "Preserve accessible names.", reason: "Preserve frontend scope." },
    { path: ".github/instructions/frontend.instructions.md", content: '---\napplyTo: "frontend/**"\n---\nRead frontend/AGENTS.md for frontend constraints.\n', reason: "Route matching Copilot work." },
  ];
  const proposal = parseSetupReview(JSON.stringify(response(report, { instructions: changes })), report, "", "model");
  await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: true });
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /Frontend: preserve/);
  await installSetup(root, proposal, { apply: true, guidance: "apply", skipLabels: true });
  assert.doesNotMatch(await readFile(join(root, "AGENTS.md"), "utf8"), /Frontend: preserve/);
  assert.match(await readFile(join(root, ".github/instructions/frontend.instructions.md"), "utf8"), /applyTo: "frontend\/\*\*"/);
  changes[2].content = "Missing scope.";
  assert.throws(() => parseSetupReview(JSON.stringify(response(report, { instructions: changes })), report, "", "model"), /applyTo/);
});

test("new hosted setups default to merge execution while explicit opt-outs remain unchanged", async (t) => {
  for (const executeOnMerge of [undefined, false]) {
    const root = await fixture(t);
    const proposal = { configBeforeHash: null, config: config({ planning: { enabled: true, model: "planner", ...(executeOnMerge === undefined ? {} : { executeOnMerge }) } }), constitutionText: null };
    await applyInstallation(root, await installation(root, proposal));
    assert.equal(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")).planning.executeOnMerge, executeOnMerge ?? true);
  }
});

test("findings cannot promise edits that have no concrete replacement", async (t) => {
  const report = await assess(await fixture(t, { "AGENTS.md": "Existing policy." }));
  const review = response(report);
  const finding = review.findings.find((item) => item.path === "AGENTS.md");
  finding.action = "edit";
  finding.editPaths = ["AGENTS.md"];
  assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "model"), /without replacement text/);
  finding.action = "defer";
  finding.editPaths = [];
  finding.deferReason = "The proposed change conflicts with an explicit human policy; choose the intended policy first.";
  assert.equal(parseSetupReview(JSON.stringify(review), report, "", "model").instructions.length, 0);
});

test("every guidance finding requires an explicit disposition and deferrals require a concrete blocker", async (t) => {
  const report = await assess(await fixture(t, { "AGENTS.md": "Existing policy." }));
  const review = response(report);
  const finding = review.findings.find((item) => item.path === "AGENTS.md");
  delete finding.action;
  assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "model"), /action.*retain.*edit.*defer/);
  finding.action = "defer";
  assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "model"), /deferral reason/i);
});

test("interactive setup offers Team All Save through the selector without typed keywords", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export {};" });
  const assessment = await assess(root), menus = [], messages = [];
  await initCommand(root, { model: "chosen-model" }, {
    analyze: async () => JSON.stringify(response(assessment)),
    ask: async () => { throw new Error("Use a selection menu, not a typed keyword."); },
    select: async (message, choices, defaultValue) => {
      menus.push({ message, choices, defaultValue });
      return "save";
    },
    report: (text) => messages.push(text),
    client() { throw new Error("No GitHub writes"); },
  });
  assert.deepEqual(menus[0].choices.map((choice) => choice.value), ["team", "all", "save"]);
  assert.equal(menus[0].defaultValue, "save", "Saving is the non-mutating default.");
  assert.ok(menus[0].choices.every((choice) => choice.name && choice.description));
  assert.ok(messages.some((text) => text.includes(response(assessment).summary)));
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});

test("adoption preserves long originals and stops only at GitHub's documented agent prompt limit", async (t) => {
  for (const body of ["# Domain persona\n\nKeep supplier and warehouse responsibilities separate.\n", "Domain constraint. ".repeat(400), "Domain constraint. ".repeat(1700)]) {
    const source = ".github/agents/catalogue.agent.md";
    const root = await fixture(t, { [source]: body }), report = await assess(root);
    const review = response(report, {
      roles: [{ ...response(report).roles[0], sourceAgent: source }],
      agentDecisions: [{ path: source, action: "adopt", reason: "Retain catalogue expertise." }],
    });
    if (body.length > 30_000) {
      assert.throws(() => parseSetupReview(JSON.stringify(review), report, "", "model"), /shorten.*original/i);
      assert.equal(await readFile(join(root, source), "utf8"), body);
      await assert.rejects(readFile(join(root, ".crewbie/managed.json")), /ENOENT/);
    } else {
      const proposal = parseSetupReview(JSON.stringify(review), report, "", "model");
      await installSetup(root, proposal, { apply: true, guidance: "skip", skipLabels: true });
      assert.ok((await readFile(join(root, ".github/agents/crewbie-catalogue.agent.md"), "utf8")).includes(body));
    }
  }
});

test("selection and confirmation menus apply All or Team only with final consent", async (t) => {
  for (const choice of ["all", "team"]) {
    const root = await fixture(t, { "AGENTS.md": "Preserve catalogue IDs.", "src/catalogue.ts": "export {};" });
    const assessment = await assess(root), confirmations = [];
    await initCommand(root, { model: "chosen-model", "skip-labels": true }, {
      analyze: async () => JSON.stringify(response(assessment, {
        instructions: [{ path: "AGENTS.md", content: "Preserve catalogue IDs.\nKeep retry backpressure.", reason: "Clarify the failure boundary." }],
      })),
      select: async () => choice,
      ask: async () => { throw new Error("No typed keywords needed."); },
      confirm: async (message, defaultValue) => {
        assert.equal(defaultValue, false);
        confirmations.push(message);
        if (message.startsWith("Enable")) return false;
        await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
        return true;
      },
      report() {}, client() { throw new Error("No GitHub writes"); },
    });
    assert.equal(confirmations.length, 2);
    assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), choice === "all"
      ? "Preserve catalogue IDs.\nKeep retry backpressure." : "Preserve catalogue IDs.");
    assert.equal(JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8")).instructions.length, 1);
  }
});

test("menu cancellation leaves the saved proposal but never installs", async (t) => {
  const root = await fixture(t, { "src/catalogue.ts": "export {};" });
  const assessment = await assess(root);
  await assert.rejects(initCommand(root, { model: "chosen-model" }, {
    analyze: async () => JSON.stringify(response(assessment)),
    ask: async () => { throw new Error("No text input expected"); },
    select: async () => { const error = new Error("Cancelled"); error.name = "ExitPromptError"; throw error; },
    report() {}, client() { throw new Error("No GitHub writes"); },
  }), /Setup cancelled.*saved proposal/);
  assert.equal(JSON.parse(await readFile(join(root, "crewbie-setup.json"), "utf8")).status, "ready");
  await assert.rejects(readFile(join(root, ".crewbie/config.json")), /ENOENT/);
});

test("strict review links every scoped move to its source and shows blocked recommendations", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Frontend: preserve focus.", "frontend/view.ts": "export {};" });
  const assessment = await assess(root), review = response(assessment, {
    instructions: [{ path: "frontend/AGENTS.md", content: "Preserve focus.", reason: "Scope frontend guidance." }],
  });
  const finding = review.findings.find((item) => item.path === "AGENTS.md");
  finding.action = "edit";
  finding.editPaths = ["frontend/AGENTS.md"];
  assert.throws(() => parseSetupReview(JSON.stringify(review), assessment, "", "model"), /source replacement/);
  finding.action = "defer";
  finding.editPaths = [];
  finding.deferReason = "The owner must decide whether focus policy also applies to the admin frontend.";
  review.instructions = [];
  const messages = [];
  await initCommand(root, { model: "model" }, {
    analyze: async (prompt) => {
      assert.match(prompt, /Review EVERY inspected guidance file independently/);
      assert.match(prompt, /not only the first file/);
      assert.match(prompt, /Put adoption mechanics in agentDecisions.reason/);
      return JSON.stringify(review);
    },
    ask: async () => "save", report: (text) => messages.push(text),
    client() { throw new Error("No GitHub writes"); },
  });
  assert.ok(messages.some((text) => text.includes("DEFERRED") && text.includes(finding.deferReason)));
  assert.match(await readFile(join(root, "crewbie-setup.md"), "utf8"), /Deferred because/);
});
