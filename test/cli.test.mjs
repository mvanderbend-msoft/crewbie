import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fixture, batch, config } from "./helpers.mjs";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (root, ...args) => execFileSync(process.execPath, [cli, "--path", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("CLI supports assessment -> reviewed installation -> specification approval -> publication preview without remote access", async (t) => {
  const root = await fixture(t, { "requirements.md": "Keep existing behavior. Add one focused feature." });
  run(root, "init", "--assessment-only", "--out", "setup.json");
  const proposal = JSON.parse(await readFile(join(root, "setup.json"), "utf8"));
  proposal.config.repository = "example/project";
  for (const role of proposal.config.roles) role.model = "approved-model";
  proposal.config.constitution = ".crewbie/constitution.md";
  proposal.constitutionText = "# Project principles\n\nPreserve documented behavior. Check changed behavior with focused tests; report existing failures separately.";
  await writeFile(join(root, "setup.json"), JSON.stringify(proposal));
  run(root, "init", "--proposal", "setup.json", "--apply", "--guidance", "apply", "--skip-labels");
  const source = JSON.parse(run(root, "status", "--source", "requirements.md"));
  assert.equal(source.revision.length, 64);
  await writeFile(join(root, "batch.json"), JSON.stringify({ ...batch(), sources: [{ uri: source.uri, revision: source.revision }] }));
  run(root, "status", "--batch", "batch.json");
  run(root, "approve", "--batch", "batch.json", "--yes", "--execute");
  assert.match(run(root, "publish", "--batch", "batch.json"), /Preview only/);
  assert.match(run(root, "status", "--memory", "developer"), /constitution\.md/);
  assert.match(run(root, "init", "--proposal", "setup.json", "--update"), /Installation preview: 0 files/);
  assert.deepEqual(JSON.parse(run(root, "init", "--proposal", "setup.json", "--update", "--json")).files, []);
  const active = JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8"));
  active.planning = { enabled: true, model: "approved-model", executeOnMerge: true };
  await writeFile(join(root, ".crewbie/config.json"), JSON.stringify(active));
  const update = JSON.parse(run(root, "update", "--offline", "--json"));
  assert.ok(update.files.some((file) => file.path.endsWith("crewbie-execute-plan.yml")));
  assert.match(run(root, "update", "--offline", "--apply"), /existing policy, models and memory preserved/);
  assert.match(await readFile(join(root, ".github/workflows/crewbie-execute-plan.yml"), "utf8"), /pull_request_target:/);
  assert.deepEqual(JSON.parse(run(root, "update", "--offline", "--json")).files, []);
});

test("CLI rejects implicit approval and unsupported input formats", async (t) => {
  const root = await fixture(t, { "x.pdf": "not text" });
  const result = spawnSync(process.execPath, [cli, "--path", root, "status", "--source", "x.pdf"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Convert Word\/PDF outside/);
});

test("CLI exposes guarded controls, validates required identifiers and previews pause without remote writes", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config()) });
  const pause = spawnSync(process.execPath, [cli, "--path", root, "pause"], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "fixture-only" } });
  assert.equal(pause.status, 0);
  assert.match(pause.stdout, /Preview: pause future/);
  for (const [command, expected] of [["cancel", /--run-id/], ["budget", /--historical-attempts/]]) {
    const result = spawnSync(process.execPath, [cli, "--path", root, command], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
  assert.match(run(root, "--help"), /preflight.*batch-id/);
});

test("CLI reassesses an installed team without resetting policy or installing changes", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config({ maxActive: 1 })), "package.json": '{"dependencies":{"react":"1"}}' });
  run(root, "init", "--assessment-only", "--update", "--out", "team.json");
  const proposal = JSON.parse(await readFile(join(root, "team.json"), "utf8"));
  assert.equal(proposal.config.maxActive, 1);
  assert.ok(proposal.config.roles.some((role) => role.id === "frontend"));
  assert.equal(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")).roles.length, 1);
  const empty = await fixture(t);
  assert.throws(() => run(empty, "init", "--update"), /No installed crew/);
});

test("CLI rejects watch without local batch dispatch and rejects orphan timing options", () => {
  for (const args of [["status", "--watch"], ["publish", "--batch", "batch.json", "--watch"], ["status", "--poll-seconds", "1"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--watch/);
  }
});

test("CLI routes PR finalization to description validation rather than batch publication", async (t) => {
  const root = await fixture(t, {
    ".crewbie/config.json": JSON.stringify(config()),
    "handoff.json": JSON.stringify({ headSha: "head", beforeHash: "hash", body: "<!-- only a comment -->" }),
  });

  const result = spawnSync(process.execPath, [cli, "--path", root, "publish", "--pr", "2", "--proposal", "handoff.json"], {
    encoding: "utf8", env: { ...process.env, GH_TOKEN: "fixture-only" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PR description is empty/);
  assert.doesNotMatch(result.stderr, /Choose a batch/);
  const ambiguous = spawnSync(process.execPath, [cli, "--path", root, "publish", "--pr", "2", "--batch", "batch.json"], { encoding: "utf8" });
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /either batch publication or PR finalization/);
});

test("CLI formats real terminal status while JSON and redirected status remain parseable", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config()), "batch.json": JSON.stringify(batch()) });
  const terminalRun = (...args) => execFileSync(process.execPath, [
    "--import", "data:text/javascript," + encodeURIComponent("Object.defineProperties(process.stdout, { isTTY: { value: true }, columns: { value: 60 } });"),
    cli, "--path", root, ...args,
  ], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const readable = terminalRun("status", "--batch", "batch.json");
  assert.match(readable, /CREWBIE \/ STATUS/);
  assert.match(readable, /TASKS/);
  assert.doesNotMatch(readable, /"schemaVersion"/);
  const machine = terminalRun("status", "--batch", "batch.json", "--json");
  assert.equal(JSON.parse(machine).id, batch().id);
  assert.deepEqual(JSON.parse(machine), JSON.parse(run(root, "status", "--batch", "batch.json")));
  const help = run(root, "--help");
  for (const section of ["SETUP AND GUIDANCE", "PLANNING AND EXECUTION", "STATUS AND REPORTS", "OUTPUT AND AUTHENTICATION"]) assert.ok(help.includes(section));
  assert.doesNotMatch(help, /\x1b/);
});

test("hosted planning preparation accepts label, PR-comment and revision-dispatch events only", async (t) => {
  const root = await fixture(t, { ".crewbie/config.json": JSON.stringify(config()), "event.json": "{}" });
  const prepare = (event) => spawnSync(process.execPath, [cli, "--path", root, "internal-plan", "--prepare"], {
    encoding: "utf8", env: { ...process.env, GH_TOKEN: "test-token", GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: join(root, "event.json"), GITHUB_OUTPUT: "" },
  });
  for (const event of ["issues", "issue_comment", "workflow_dispatch"]) {
    const result = prepare(event);
    assert.equal(result.status, 0, `${event}: ${result.stderr}`);
  }
  assert.match(prepare("pull_request").stderr, /requires a GitHub issues, issue_comment or workflow_dispatch event/);
});