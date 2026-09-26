import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "../dist/config.js";
import { featureBranch, issueBody, parseBatch } from "../dist/specification/batch.js";
import { parseReview, prepareReview, publishReview } from "../dist/execution/pr-review.js";
import { config, batch, fixture } from "./helpers.mjs";

const HEAD = "c".repeat(40);
const BRANCH = featureBranch(parseBatch(batch(), config()));
const reviewConfig = config({ review: { enabled: true, role: "developer" } });

test("legacy merge.mode and merge.minConfidence are ignored and the reviewer must be a configured role", () => {
  assert.equal(parseConfig(config()).merge, undefined);
  assert.deepEqual(parseConfig(config({ merge: { mode: "manual" } })).merge, { method: "merge" });
  assert.deepEqual(parseConfig(config({ merge: { method: "squash", minConfidence: 0.9 } })).merge, { method: "squash" });
  assert.throws(() => parseConfig(config({ review: { enabled: true, role: "ghost" } })), /not a configured role/);
  assert.deepEqual(parseConfig(reviewConfig).review, { enabled: true, role: "developer" });
});

test("the verdict follows the findings, so a blocking finding can never pass", () => {
  const review = parseReview('```json\n{"verdict":"pass","summary":"Fine.","findings":[{"severity":"blocking","path":"a.ts","line":1,"body":"Crashes."}]}\n```');
  assert.equal(review.verdict, "changes");
  assert.throws(() => parseReview('{"verdict":"ship it","summary":"x","findings":[]}'), /pass or changes/);
});

async function setup(t) {
  const root = await fixture(t, {
    ".github/agents/crewbie-developer.agent.md": "---\nname: crewbie-developer\n---\nYou are a grumpy but precise reviewer.",
    ".crewbie/decisions.md": "# Decisions\n", ".crewbie/team/developer/hot.md": "# Hot\n", ".crewbie/team/developer/index.md": "# Index\n",
  });
  const b = parseBatch(batch(), config());
  const pull = { number: 101, state: "open", title: "Crewbie feature", body: "What/why", head: { sha: HEAD, ref: BRANCH, repo: { full_name: "example/project" } }, base: { ref: "main" } };
  const comments = [];
  const client = {
    async list(path) {
      if (path === "/repos/example/project/issues?state=all&labels=crewbie%3Amanaged") {
        return b.tasks.map((task, index) => ({ number: index + 1, title: task.title, body: issueBody(b, task), labels: ["crewbie:managed"] }));
      }
      if (path.endsWith("/pulls/101/files")) return [{ filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-old\n+new" }];
      if (path.endsWith("/issues/101/comments")) return comments;
      throw new Error(`Unexpected list: ${path}`);
    },
    async request(method, path, body) {
      if (path === "/graphql") return { data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 1 }, { number: 2 }, { number: 3 }] } } } } };
      if (path === "/repos/example/project") return { default_branch: "main" };
      if (path.endsWith("/pulls/101")) return structuredClone(pull);
      const issue = /\/issues\/([123])$/.exec(path);
      if (issue) return { number: Number(issue[1]), body: issueBody(b, b.tasks[Number(issue[1]) - 1]) };
      if (method === "POST" && path.endsWith("/issues/101/comments")) { comments.push({ body: body.body }); return {}; }
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  };
  return { root, pull, comments, client };
}

test("review preparation uses the reviewer's charter and the API diff; publication posts one verified-head comment per run", async (t) => {
  const { root, pull, comments, client } = await setup(t);
  assert.deepEqual(await prepareReview(root, client, config(), 101, HEAD, 55), { ready: false, reason: "Crewbie PR review is disabled.", model: "" });
  const prepared = await prepareReview(root, client, reviewConfig, 101, HEAD, 55);
  assert.equal(prepared.ready, true);
  assert.equal(prepared.model, "approved-model");
  const prompt = await readFile(join(root, ".crewbie-review-prompt.txt"), "utf8");
  assert.match(prompt, /voice your charter gives you[\s\S]*grumpy but precise[\s\S]*Implement foundation[\s\S]*--- src\/a\.ts \(modified, \+2 -1\)\n@@/);
  await writeFile(join(root, ".crewbie-review-output.txt"), JSON.stringify({ verdict: "changes", summary: "Hmph.", findings: [{ severity: "blocking", path: "src/a.ts", line: 2, body: "Handle null." }] }));
  assert.match(await publishReview(root, client, reviewConfig), /changes/);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /^<!-- crewbie-review:[A-Za-z0-9+/=]+ -->\n## Crewbie review · crewbie-developer[\s\S]*changes requested[\s\S]*\*\*Blocking\*\* `src\/a\.ts:2`: Handle null\.[\s\S]*Push fixes to `crewbie\/feature-[0-9a-f]{8}`/);
  assert.match(await publishReview(root, client, reviewConfig), /already posted/);
  assert.equal(comments.length, 1);
  pull.head.sha = "d".repeat(40);
  assert.match(await publishReview(root, client, reviewConfig), /moved or closed/);
  assert.equal((await prepareReview(root, client, reviewConfig, 101, HEAD, 56)).ready, false, "A stale head is never reviewed.");
});

test("only Crewbie feature PRs into the default branch are reviewed", async (t) => {
  const { root, pull, client } = await setup(t);
  pull.head.ref = "copilot/foundation";
  assert.match((await prepareReview(root, client, reviewConfig, 101, HEAD, 58)).reason, /not a Crewbie feature PR/);
  Object.assign(pull, { head: { ...pull.head, ref: BRANCH }, base: { ref: "crewbie/other" } });
  assert.equal((await prepareReview(root, client, reviewConfig, 101, HEAD, 59)).ready, false);
});
test("a feature PR is reviewed against every task of its plan, and the verdict leaves the merge to a human", async (t) => {
  const { root, comments, client } = await setup(t);
  const b = parseBatch(batch(), config());
  assert.equal((await prepareReview(root, client, reviewConfig, 101, HEAD, 60)).ready, true);
  const prompt = await readFile(join(root, ".crewbie-review-prompt.txt"), "utf8");
  assert.match(prompt, /merges every task of plan feature from crewbie\/feature-[0-9a-f]{8} into the default branch/);
  for (const task of b.tasks) assert.ok(prompt.includes(task.title), task.title);
  await writeFile(join(root, ".crewbie-review-output.txt"), JSON.stringify({ verdict: "pass", summary: "Fits together.", findings: [] }));
  assert.match(await publishReview(root, client, reviewConfig), /pass/);
  assert.match(comments[0].body, /feature `crewbie\/feature-[0-9a-f]{8}`[\s\S]*Test the feature on `crewbie\/feature-[0-9a-f]{8}`, then merge this PR yourself; Crewbie never merges it/);
  assert.doesNotMatch(comments[0].body, /address-review/);
});

test("review output containing a secret is never posted", async (t) => {
  const { root, comments, client } = await setup(t);
  await prepareReview(root, client, reviewConfig, 101, HEAD, 57);
  await writeFile(join(root, ".crewbie-review-output.txt"), JSON.stringify({ verdict: "pass", summary: `token ghp_${"x".repeat(30)}`, findings: [] }));
  await assert.rejects(publishReview(root, client, reviewConfig), /secret/);
  assert.equal(comments.length, 0);
});

test("every Crewbie label description fits GitHub's 100-character limit", async () => {
  const { labelDescription, setupLabels } = await import("../dist/tracking/issues.js");
  for (const name of setupLabels(config())) assert.ok(labelDescription(name).length <= 100, `${name} description is too long for GitHub.`);
});
