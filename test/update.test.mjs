import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, fixture } from "./helpers.mjs";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { updateRepository } from "../dist/setup/update.js";
import { PACKAGE_PIN } from "../dist/setup/package.js";
import { GitHubError, hash } from "../dist/core.js";

async function installed(t) {
  const root = await fixture(t);
  await applyInstallation(root, await installation(root, { config: config(), constitutionText: null }));
  return root;
}

test("repository update regenerates workflows from current policy without resetting edited config or memory", async (t) => {
  const root = await installed(t);
  const active = config({ planning: { enabled: true, model: "planner", executeOnMerge: true }, maxActive: 1 });
  await writeFile(join(root, ".crewbie/config.json"), JSON.stringify(active));
  await writeFile(join(root, ".crewbie/team/developer/hot.md"), "Reviewed integration constraint.\n");
  const before = await readFile(join(root, ".github/workflows/crewbie-execute-plan.yml"), "utf8");
  const preview = JSON.parse(await updateRepository(root, { offline: true, json: true }));
  assert.ok(preview.files.some((change) => change.path.endsWith("crewbie-execute-plan.yml") && change.after.includes("pull_request_target:")));
  assert.equal(await readFile(join(root, ".github/workflows/crewbie-execute-plan.yml"), "utf8"), before);
  await updateRepository(root, { offline: true, apply: true });
  assert.equal(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")).maxActive, 1);
  assert.equal(await readFile(join(root, ".crewbie/team/developer/hot.md"), "utf8"), "Reviewed integration constraint.\n");
  assert.deepEqual(JSON.parse(await updateRepository(root, { offline: true, json: true })).files, []);
});

test("repository update reports all edited managed-file conflicts and applies nothing", async (t) => {
  const root = await installed(t);
  for (const path of [".crewbie/instructions.md", ".github/agents/crewbie-developer.agent.md"]) {
    await writeFile(join(root, path), "My approved custom content.\n");
  }
  const manifest = await readFile(join(root, ".crewbie/managed.json"), "utf8");
  const preview = JSON.parse(await updateRepository(root, { offline: true, json: true }));
  assert.equal(preview.conflicts.length, 2);
  await assert.rejects(updateRepository(root, { offline: true, apply: true }), /no changes applied/);
  assert.equal(await readFile(join(root, ".crewbie/managed.json"), "utf8"), manifest);
});

test("repository update previews and synchronizes an old Actions package override without dispatch", async (t) => {
  const root = await installed(t);
  let value = "https://example.invalid/approved-old.tgz";
  const writes = [];
  const client = {
    async request(method, path, body) {
      if (path === "/user") return { login: "maintainer", type: "User" };
      assert.equal(path, "/repos/example/project/actions/variables/CREWBIE_PACKAGE");
      if (method === "GET") return { value };
      assert.equal(method, "PATCH");
      writes.push(body); value = body.value; return null;
    },
  };
  const preview = JSON.parse(await updateRepository(root, { json: true }, client));
  assert.equal(preview.packageVariable.after, PACKAGE_PIN);
  assert.equal(writes.length, 0);
  await updateRepository(root, { apply: true }, client);
  assert.equal(value, PACKAGE_PIN);
  assert.equal(writes.length, 1);
});

test("repository update tells planning installs how to set a missing Copilot CLI version", async (t) => {
  const root = await installed(t);
  await writeFile(join(root, ".crewbie/config.json"), JSON.stringify(config({ planning: { enabled: true, model: "planner", executeOnMerge: true } })));
  const client = { async request() { throw new GitHubError(404, null); } };
  const preview = await updateRepository(root, {}, client);
  assert.match(preview, /gh variable set CREWBIE_COPILOT_VERSION --repo example\/project/);
  assert.equal(JSON.parse(await updateRepository(root, { json: true }, client)).copilotVersionMissing, true);
});

test("repository update refreshes an unedited old shared policy but preserves an explicit execution opt-out", async (t) => {
  const root = await installed(t);
  const path = ".crewbie/instructions.md";
  const previous = "Previous generated shared policy.\n";
  await writeFile(join(root, path), previous);
  const owned = JSON.parse(await readFile(join(root, ".crewbie/managed.json"), "utf8"));
  owned[path] = hash(previous);
  await writeFile(join(root, ".crewbie/managed.json"), JSON.stringify(owned));
  await writeFile(join(root, ".crewbie/config.json"), JSON.stringify(config({ planning: { enabled: true, model: "planner", executeOnMerge: false } })));
  await updateRepository(root, { apply: true, offline: true });
  assert.match(await readFile(join(root, path), "utf8"), /Hot memory holds gotchas only/);
  assert.equal(JSON.parse(await readFile(join(root, ".crewbie/config.json"), "utf8")).planning.executeOnMerge, false);
});
