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
  run(root, "init", "--out", "setup.json");
  const proposal = JSON.parse(await readFile(join(root, "setup.json"), "utf8"));
  proposal.config.repository = "example/project";
  proposal.config.approvers = ["maintainer"];
  for (const role of proposal.config.roles) role.model = "approved-model";
  proposal.config.constitution = ".crewbie/constitution.md";
  proposal.constitutionText = "# Project principles\n\nPreserve documented behavior. Check changed behavior with focused tests; report existing failures separately.";
  await writeFile(join(root, "setup.json"), JSON.stringify(proposal));
  run(root, "init", "--proposal", "setup.json", "--apply");
  const source = JSON.parse(run(root, "status", "--source", "requirements.md"));
  assert.equal(source.revision.length, 64);
  await writeFile(join(root, "batch.json"), JSON.stringify({ ...batch(), sources: [{ uri: source.uri, revision: source.revision }] }));
  run(root, "status", "--batch", "batch.json");
  run(root, "approve", "--batch", "batch.json", "--yes", "--execute");
  assert.match(run(root, "publish", "--batch", "batch.json"), /Preview only/);
  assert.match(run(root, "status", "--memory", "developer"), /constitution\.md/);
  assert.deepEqual(JSON.parse(run(root, "init", "--proposal", "setup.json", "--update").split("\nPreview")[0]), []);
});

test("CLI rejects implicit approval and unsupported input formats", async (t) => {
  const root = await fixture(t, { "x.pdf": "not text" });
  const result = spawnSync(process.execPath, [cli, "--path", root, "status", "--source", "x.pdf"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Convert Word\/PDF outside/);
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
    "handoff.json": JSON.stringify({ headSha: "head", beforeHash: "hash", body: "Missing required sections." }),
  });
  const result = spawnSync(process.execPath, [cli, "--path", root, "publish", "--pr", "2", "--proposal", "handoff.json"], {
    encoding: "utf8", env: { ...process.env, GH_TOKEN: "fixture-only" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /What changed/);
  assert.doesNotMatch(result.stderr, /Choose a batch/);
  const ambiguous = spawnSync(process.execPath, [cli, "--path", root, "publish", "--pr", "2", "--batch", "batch.json"], { encoding: "utf8" });
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /either batch publication or PR finalization/);
});
