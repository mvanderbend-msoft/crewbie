import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "../dist/config.js";
import { issueBody, parseBatch } from "../dist/specification/batch.js";
import { parseReview, prepareReview, publishReview } from "../dist/execution/pr-review.js";
import { config, batch, fixture } from "./helpers.mjs";

const HEAD = "c".repeat(40);
const reviewConfig = config({ review: { enabled: true, role: "developer" }, merge: { mode: "auto", method: "merge" } });

test("merge defaults to manual; auto mode requires an enabled reviewer that is a configured role", () => {
  assert.equal(parseConfig(config()).merge, undefined);
  assert.deepEqual(parseConfig(config({ merge: { mode: "manual" } })).merge, { mode: "manual", method: "merge" });
  assert.throws(() => parseConfig(config({ merge: { mode: "auto" } })), /enable review/);
  assert.throws(() => parseConfig(config({ merge: { mode: "yes" } })), /merge.mode must be auto or manual/);
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
  const pull = { number: 101, state: "open", title: "Add foundation", body: "What/why", head: { sha: HEAD } };
  const comments = [];
  const client = {
    async list(path) {
      if (path.endsWith("/pulls/101/files")) return [{ filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-old\n+new" }];
      if (path.endsWith("/issues/101/comments")) return comments;
      throw new Error(`Unexpected list: ${path}`);
    },
    async request(method, path, body) {
      if (path === "/graphql") return { data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 1 }] } } } } };
      if (path.endsWith("/pulls/101")) return structuredClone(pull);
      if (path.endsWith("/issues/1")) return { number: 1, body: issueBody(b, b.tasks[0]) };
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
  assert.match(comments[0].body, /^<!-- crewbie-review:[A-Za-z0-9+/=]+ -->\n## Crewbie review · crewbie-developer[\s\S]*changes requested[\s\S]*\*\*Blocking\*\* `src\/a\.ts:2`: Handle null\.[\s\S]*crewbie:address-review/);
  assert.match(await publishReview(root, client, reviewConfig), /already posted/);
  assert.equal(comments.length, 1);
  pull.head.sha = "d".repeat(40);
  assert.match(await publishReview(root, client, reviewConfig), /moved or closed/);
  assert.equal((await prepareReview(root, client, reviewConfig, 101, HEAD, 56)).ready, false, "A stale head is never reviewed.");
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
