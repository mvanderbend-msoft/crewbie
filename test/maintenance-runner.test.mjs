import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, config, batch } from "./helpers.mjs";
import { installation, applyInstallation } from "../dist/setup/install.js";
import { prepareMaintenance, applyMaintenance } from "../dist/memory/runner.js";
import { issueBody, parseBatch } from "../dist/specification/batch.js";
import { GitHubError } from "../dist/core.js";

test("nightly prepare includes affected specialist history and advances no-change evidence without a PR", async (t) => {
  const root = await fixture(t, {
    ".crewbie/team/developer/hot.md": "Preserve current behavior. Prior regression decisions matter.",
    ".crewbie/team/developer/index.md": "[Regression testing](cold/regression-testing.md)\n[Deployment](cold/deployment.md)",
    ".crewbie/team/developer/cold/regression-testing.md": "Approved lesson: add a focused regression test. Evidence: earlier reviewed PR.",
    ".crewbie/team/developer/cold/deployment.md": "Unrelated history should not be loaded.",
    ".crewbie/team/improver/index.md": "[Regression proposal outcome](archive/regression-outcome.md)",
    ".crewbie/team/improver/archive/regression-outcome.md": "An earlier broad rewrite was declined. Keep regression guidance narrow.",
  });
  const cfg = config({ nightly: { ...config().nightly, enabled: true } });
  await applyInstallation(root, await installation(root, { config: cfg, constitutionText: null }));
  const b = parseBatch(batch(), cfg);
  const issue = {
    number: 1, title: "Regression testing feedback", body: issueBody(b, b.tasks[0]),
    updated_at: "2026-09-22T07:00:00Z", labels: ["crewbie:managed"],
  };
  const mutations = [];
  let state = null;
  let pendingState = null;
  const client = {
    async list(path) {
      if (path.includes("/issues?")) return [issue];
      if (path.includes("/pulls?") || path.endsWith("/timeline")) return [];
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      if (path === "/graphql") return { data: { repository: { issue: { closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } };
      if (method === "GET" && path.includes("/git/ref/heads/crewbie/runtime")) {
        if (!state) throw new GitHubError(404, null);
        return { object: { sha: "runtime-commit" } };
      }
      if (method === "GET" && path.includes("/contents/state.json")) {
        return { encoding: "base64", content: Buffer.from(state).toString("base64") };
      }
      mutations.push({ method, path, body });
      if (path.endsWith("/git/trees")) { pendingState = body.tree[0].content; return { sha: "runtime-tree" }; }
      if (path.endsWith("/git/commits")) return { sha: "runtime-commit" };
      if (path.endsWith("/git/refs")) { state = pendingState; return {}; }
      throw new Error(`Unexpected request ${method} ${path}`);
    },
  };
  assert.equal(await prepareMaintenance(root, client, cfg), 1);
  const prompt = await readFile(join(root, ".crewbie-maintenance-prompt.txt"), "utf8");
  assert.match(prompt, /developer\/hot\.md/);
  assert.match(prompt, /Approved lesson: add a focused regression test/);
  assert.match(prompt, /earlier broad rewrite was declined/);
  assert.doesNotMatch(prompt, /Unrelated history should not be loaded/);
  await writeFile(join(root, ".crewbie-maintenance-output.txt"), JSON.stringify({ summary: "Existing guidance already covers this feedback.", changes: [] }));
  assert.match(await applyMaintenance(root, client, cfg), /without opening a PR/);
  assert.ok(mutations.every((call) => !call.path.includes("/pulls")));
  assert.equal(Object.keys(JSON.parse(state).processed).length, 1);
  assert.equal(await prepareMaintenance(root, client, cfg), 0);
  await assert.rejects(readFile(join(root, ".crewbie-maintenance-input.json")), /ENOENT/);
});
