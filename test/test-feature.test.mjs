import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkoutTestFeature, discoverTestFeatures, matchingTestFeatures, runStartCommand, suggestedStartCommand } from "../dist/execution/test-feature.js";
import { parseConfig } from "../dist/config.js";
import { GitHubError, json, textHash } from "../dist/core.js";
import { featureBranch, issueBody, parseBatch } from "../dist/specification/batch.js";
import { batch, config, fixture, task } from "./helpers.mjs";

function sourceBatch(id, issue) {
  return {
    ...batch(),
    id,
    sources: [{ uri: `https://github.com/example/project/issues/${issue}`, revision: "source" }],
    tasks: [task(`${id}-one`), task(`${id}-two`)],
  };
}

test("configuration preserves absent local.start and validates configured start", () => {
  const before = json(parseConfig(config()));
  const parsed = parseConfig(config());
  assert.equal("local" in parsed, false);
  assert.equal(textHash(json(parsed)), textHash(before));
  assert.deepEqual(parseConfig(config({ local: { start: "npm run dev" } })).local, { start: "npm run dev" });
  assert.throws(() => parseConfig(config({ local: { start: "" } })), /local\.start/);
});

test("init start suggestion detects package-manager scripts without running them", async (t) => {
  assert.equal(await suggestedStartCommand(await fixture(t, {
    "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
  })), "npm run dev");
  assert.equal(await suggestedStartCommand(await fixture(t, {
    "pnpm-lock.yaml": "",
    "package.json": JSON.stringify({ scripts: { "install:all": "npm install", dev: "vite" } }),
  })), "pnpm run install:all && pnpm run dev");
  assert.equal(await suggestedStartCommand(await fixture(t, {
    "yarn.lock": "",
    "package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
  })), "yarn start");
  assert.equal(await suggestedStartCommand(await fixture(t, { "README.md": "No package manifest." })), null);
});

test("feature discovery combines feature PRs and in-progress task branches", async () => {
  const readyBatch = parseBatch(sourceBatch("issue-73", 73), config());
  const activeBatch = parseBatch(sourceBatch("issue-99", 99), config());
  const readyBranch = featureBranch(readyBatch);
  const activeBranch = featureBranch(activeBatch);
  const readyBody = [
    "Every task merged.",
    "",
    "## Tasks",
    "- #75 Implement first (#81)",
    "- #76 Implement second (#82)",
    "",
    "Closes #75",
    "Closes #76",
    "Closes #73",
    "",
    "<!-- crewbie-feature:issue-73 -->",
  ].join("\n");
  const issues = [
    ...readyBatch.tasks.map((item, index) => ({
      number: 75 + index, state: "closed", title: item.title, body: issueBody(readyBatch, item),
      labels: ["crewbie:managed", "crewbie:done"],
    })),
    ...activeBatch.tasks.map((item, index) => ({
      number: 90 + index, state: "open", title: item.title, body: issueBody(activeBatch, item),
      labels: ["crewbie:managed", index === 0 ? "crewbie:done" : "crewbie:running"],
    })),
  ];
  const client = {
    async list(path) {
      if (path.endsWith("/pulls?state=open")) return [{
        number: 120, title: "Crewbie feature: PRD: Galactic Ratings product reviews (#73)",
        body: readyBody, html_url: "https://github.com/example/project/pull/120", head: { ref: readyBranch },
      }];
      if (path.includes("/issues?state=open")) return issues.filter((issue) => issue.state === "open");
      if (path.includes("/issues?state=closed")) return issues.filter((issue) => issue.state === "closed");
      throw new Error(`Unexpected list: ${path}`);
    },
    async request(method, path) {
      if (method === "GET" && path.endsWith("/issues/73")) return { title: "PRD: Galactic Ratings product reviews" };
      if (method === "GET" && path.endsWith("/issues/99")) return { title: "PRD: Lunar Coupons" };
      if (method === "GET" && path.endsWith(`/git/ref/heads/${activeBranch}`)) return { ref: `refs/heads/${activeBranch}` };
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  };
  const features = await discoverTestFeatures(client, config());
  assert.equal(features.length, 2);
  assert.equal(features[0].status, "ready for testing");
  assert.equal(features[0].branch, readyBranch);
  assert.deepEqual(features[0].sourceIssues, [73]);
  assert.equal(features[0].pullRequest.number, 120);
  assert.equal(features[1].status, "in progress");
  assert.equal(features[1].branch, activeBranch);
  assert.deepEqual(features[1].tasks, { done: 1, total: 2 });
});

test("feature matching accepts issue numbers, PR numbers, branch names and title words", () => {
  const features = [
    { branch: "crewbie/issue-73-aaaaaaaa", batch: "issue-73", title: "Crewbie feature: Galactic Ratings", status: "ready for testing", sourceIssues: [73], pullRequest: { number: 120, url: "url", title: "Crewbie feature: Galactic Ratings" } },
    { branch: "crewbie/issue-99-bbbbbbbb", batch: "issue-99", title: "PRD: Lunar Coupons", status: "in progress", sourceIssues: [99] },
  ];
  assert.equal(matchingTestFeatures(features, "73")[0].branch, features[0].branch);
  assert.equal(matchingTestFeatures(features, "#120")[0].branch, features[0].branch);
  assert.equal(matchingTestFeatures(features, "crewbie/issue-99-bbbbbbbb")[0].branch, features[1].branch);
  assert.equal(matchingTestFeatures(features, "lunar coupons")[0].branch, features[1].branch);
  assert.equal(matchingTestFeatures(features, "issue").length, 2);
});

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function gitRepoWithOrigin(t) {
  const root = await fixture(t, { "app.txt": "main\n" });
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  const origin = await mkdtemp(join(tmpdir(), "crewbie-origin-"));
  t.after(() => rm(origin, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--bare", root, origin], { stdio: "ignore" });
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["switch", "-c", "crewbie/feature-test"]);
  await writeFile(join(root, "app.txt"), "feature\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "feature"]);
  git(root, ["push", "-u", "origin", "crewbie/feature-test"]);
  git(root, ["switch", "main"]);
  return root;
}

test("feature checkout refuses dirty trees and checks out a clean remote branch", async (t) => {
  const root = await gitRepoWithOrigin(t);
  await writeFile(join(root, "dirty.txt"), "dirty\n");
  await assert.rejects(checkoutTestFeature(root, { branch: "crewbie/feature-test", batch: "feature", title: "Feature", status: "ready for testing", sourceIssues: [] }), /uncommitted changes/);
  await rm(join(root, "dirty.txt"));
  const result = await checkoutTestFeature(root, { branch: "crewbie/feature-test", batch: "feature", title: "Feature", status: "ready for testing", sourceIssues: [] });
  assert.equal(result.previous, "main");
  assert.equal(git(root, ["branch", "--show-current"]), "crewbie/feature-test");
  assert.equal((await readFile(join(root, "app.txt"), "utf8")).replaceAll("\r\n", "\n"), "feature\n");
});

test("start command exit code is propagated", async (t) => {
  const root = await fixture(t);
  assert.equal(await runStartCommand(root, `${JSON.stringify(process.execPath)} -e "process.exit(3)"`), 3);
});
