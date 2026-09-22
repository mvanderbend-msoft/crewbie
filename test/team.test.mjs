import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assess } from "../dist/setup/assessment.js";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { parseConfig } from "../dist/config.js";
import { hash, json } from "../dist/core.js";
import { fixture, config } from "./helpers.mjs";

test("team hints use bounded manifests and real project surfaces, not a fixed frontend/backend roster", async (t) => {
  const root = await fixture(t, {
    "package.json": JSON.stringify({ dependencies: { react: "1", express: "1", openai: "1" }, bin: { tool: "./cli.js" }, scripts: { test: "MUST-NOT-RUN" } }),
    "infra/main.tf": "resource {}",
    "analytics/dbt_project.yml": "name: metrics",
    "mobile/pubspec.yaml": "dependencies:\n  flutter:\n    sdk: flutter",
    "docs/mkdocs.yml": "site_name: Guide",
    "examples/server/demo.py": "not production",
  });
  const report = await assess(root);
  assert.deepEqual(report.config.roles.map((role) => role.id), ["frontend", "backend", "infrastructure", "data", "mobile", "ai", "cli", "documentation", "tester", "reviewer"]);
  assert.ok(report.team.suggestions.find((item) => item.role.id === "frontend").evidence.includes("package.json"));
  assert.ok(report.config.roles.every((role) => role.model === ""));
  assert.equal(report.configBeforeHash, null);
});

test("server framework manifests identify backends outside a directory named backend", async (t) => {
  const root = await fixture(t, {
    "service/pom.xml": "<project><artifactId>spring-boot-starter-web</artifactId></project>",
    "web/Web.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"/>',
    "app/requirements.txt": "fastapi>=0.1",
  });
  const report = await assess(root);
  assert.deepEqual(report.team.suggestions.find((item) => item.role.id === "backend").evidence, ["app/requirements.txt", "service/pom.xml", "web/Web.csproj"]);
});

test("ignored, test, example and generated files do not grow the proposed crew", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "ignored/\n",
    "ignored/infra/main.tf": "ignored",
    "test/server/fake.py": "fixture",
    "src/Only.test.tsx": "test",
    "examples/package.json": '{"dependencies":{"openai":"1"}}',
    ".crewbie/plans/package.json": '{"dependencies":{"react":"1"}}',
    "dist/ui.jsx": "generated",
  });
  assert.deepEqual((await assess(root)).config.roles.map((role) => role.id), ["developer", "tester", "reviewer"]);
});

test("reassessment preserves approved policy, custom roles, models and history while proposing new expertise", async (t) => {
  const approved = config({
    roles: [{ id: "billing", purpose: "Protect billing invariants.", model: "billing-model", checks: ["Verify rounding."], nonNegotiables: ["Preserve posted invoices."] }],
    maxActive: 1, constitution: "principles.md",
    planning: { enabled: true, model: "planning-model" },
    ado: { organization: "example", project: "Billing", workItemType: "Story" },
  });
  const root = await fixture(t, { "principles.md": "Preserve billing contracts." });
  await applyInstallation(root, await installation(root, { config: approved, constitutionText: null }));
  await writeFile(join(root, ".crewbie/team/billing/hot.md"), "Approved rounding lesson.");
  await writeFile(join(root, "package.json"), '{"dependencies":{"react":"1"}}');
  const installed = JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8"));
  const report = await assess(root);
  assert.deepEqual({ ...report.config, roles: installed.roles }, installed);
  assert.deepEqual(report.config.roles[0], approved.roles[0]);
  assert.ok(report.team.reviewExisting.some((role) => role.id === "billing"));
  assert.equal(report.config.roles.find((role) => role.id === "frontend").model, "");
  assert.deepEqual(report.config.nightly.allowedPaths, approved.nightly.allowedPaths);
  for (const role of report.config.roles) if (!role.model) role.model = "reviewed-new-model";
  await applyInstallation(root, await installation(root, report));
  assert.equal(await readFile(join(root, ".crewbie/team/billing/hot.md"), "utf8"), "Approved rounding lesson.");
  const again = await assess(root);
  assert.deepEqual(again.config.roles, parseConfig(report.config).roles);
  assert.deepEqual(await installation(root, report), []);
});

test("stale reassessment cannot overwrite intervening approved policy changes", async (t) => {
  const root = await fixture(t);
  await applyInstallation(root, await installation(root, { config: config(), constitutionText: null }));
  const stale = await assess(root);
  await applyInstallation(root, await installation(root, { config: config({ maxActive: 1 }), constitutionText: null }));
  stale.config.maxActive = 3;
  await assert.rejects(installation(root, stale), /changed since assessment/);
  assert.equal(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")).maxActive, 1);
});

test("custom specialization and explicitly approved retirement preserve historical files", async (t) => {
  const root = await fixture(t);
  await applyInstallation(root, await installation(root, { config: config(), constitutionText: null }));
  const report = await assess(root);
  report.config.roles = [{ id: "payments-ledger", purpose: "Protect ledger postings.", model: "ledger-model", checks: ["Reconcile debit and credit totals."], nonNegotiables: ["Posted entries remain immutable."] }];
  await applyInstallation(root, await installation(root, report));
  assert.match(await readFile(join(root, ".github/agents/crewbie-payments-ledger.agent.md"), "utf8"), /Posted entries remain immutable/);
  assert.ok(await readFile(join(root, ".crewbie/team/developer/hot.md"), "utf8"));
  assert.deepEqual(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")).roles.map((role) => role.id), ["payments-ledger"]);
});

test("malformed and oversized discovery inputs are disclosed, not interpreted as successful inspection", async (t) => {
  const root = await fixture(t, { "package.json": "{bad json", "large/package.json": " ".repeat(65537) });
  const report = await assess(root);
  assert.match(report.team.coverage.warnings[0], /invalid JSON/);
  assert.ok(report.team.coverage.omitted.includes("large/package.json"));
  await mkdir(join(root, ".crewbie"));
  await writeFile(join(root, ".crewbie/config.json"), "{}");
  await assert.rejects(assess(root), /Unsupported configuration/);
});

test("first-install snapshots also detect an intervening installation", async (t) => {
  const root = await fixture(t);
  const old = await assess(root);
  await applyInstallation(root, await installation(root, { config: config(), constitutionText: null }));
  await assert.rejects(installation(root, old), /changed since assessment/);
  const text = await readFile(join(root, ".crewbie/config.json"), "utf8");
  const fresh = await assess(root);
  assert.equal(fresh.configBeforeHash, hash(text));
  assert.ok(json(fresh).includes('"team"'));
});

test("reassessment fingerprints survive LF/CRLF checkouts without treating them as policy edits", async (t) => {
  const root = await fixture(t);
  await applyInstallation(root, await installation(root, { config: config(), constitutionText: null }));
  const proposal = await assess(root);
  proposal.config.maxActive = 1;
  const path = join(root, ".crewbie/config.json");
  await writeFile(path, (await readFile(path, "utf8")).replaceAll("\n", "\r\n"));
  assert.ok((await installation(root, proposal)).some((change) => change.path === ".crewbie/config.json"));
});
