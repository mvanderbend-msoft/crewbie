import test from "node:test";
import assert from "node:assert/strict";
import { handleFeatureFixComment } from "../dist/execution/fix.js";
import { featureTasks, parseReview, renderReview } from "../dist/execution/pr-review.js";
import { featureBranch, issueBody, taskMetadata, batchDigest } from "../dist/specification/batch.js";
import { GitHubError } from "../dist/core.js";
import { config, task } from "./helpers.mjs";

const HEAD = "a".repeat(40);
const CURRENT = "b".repeat(40);
const actor = { login: "maintainer", type: "User" };

function fixFixture({ merge = "conflict", reviewFindings = true } = {}) {
  const cfg = config({
    review: { enabled: true, role: "developer" },
    roles: [
      { id: "developer", purpose: "Backend fixes.", model: "approved-model" },
      { id: "frontend", purpose: "UI fixes.", model: "frontend-model" },
    ],
  });
  const b = {
    schemaVersion: 1, id: "issue-73", spec: "Build ratings.",
    sources: [{ uri: "https://github.com/example/project/issues/73", revision: "source-v1" }],
    tasks: [
      task("api"),
      { ...task("ui"), owner: "frontend", model: "frontend-model" },
    ],
    approval: null,
  };
  const branch = featureBranch(b);
  const issues = b.tasks.map((item, index) => ({ number: index + 1, state: "open", title: item.title, body: issueBody(b, item), labels: ["crewbie:managed", `crewbie:owner:${item.owner}`, "crewbie:done"] }));
  const pulls = new Map([
    [101, { number: 101, state: "closed", merged_at: "then", user: { login: "Copilot" }, base: { ref: branch }, head: { ref: "copilot/api", sha: "1".repeat(40) } }],
    [102, { number: 102, state: "closed", merged_at: "then", user: { login: "Copilot" }, base: { ref: branch }, head: { ref: "copilot/ui", sha: "2".repeat(40) } }],
  ]);
  const files = new Map([[101, ["src/api.ts", "src/model.ts"]], [102, ["ui/Button.tsx"]]]);
  const feature = { number: 87, state: "open", merged_at: null, title: "Feature", body: "Old", head: { ref: branch, sha: CURRENT, repo: { full_name: "example/project" } }, base: { ref: "main", repo: { full_name: "example/project" } } };
  const comments = new Map();
  const review = parseReview(JSON.stringify({
    verdict: reviewFindings ? "changes" : "pass",
    summary: "Needs work.",
    findings: reviewFindings ? [
      { severity: "blocking", path: "src/api.ts", line: 12, body: "Handle empty ratings." },
      { severity: "blocking", path: "ui/Button.tsx", line: 4, body: "Keep the button accessible." },
    ] : [],
  }));
  comments.set(87, [{
    id: 1000, user: { login: "github-actions[bot]", type: "Bot" }, created_at: "r1", updated_at: "r1", html_url: "https://comment/review",
    body: renderReview(cfg, { schemaVersion: 1, pr: 87, head: HEAD, feature: { batch: b.id, branch }, role: "developer", runId: 55, omitted: [] }, review),
  }]);
  for (const issue of issues) comments.set(issue.number, []);
  const state = { cfg, b, branch, issues, pulls, files, feature, comments, created: [], dispatches: [], merges: [], patches: [], posted: [] };
  state.sourceIssue = { number: 73, title: "Build ratings.", body: "", updated_at: "source-v1" };
  const prefix = "/repos/example/project";
  state.client = {
    async list(path) {
      if (path === `${prefix}/issues?state=all&labels=crewbie%3Amanaged`) return state.issues;
      if (path === `${prefix}/issues?state=open&labels=crewbie%3Amanaged`) return state.issues.filter((issue) => issue.state === "open");
      const issueComments = /\/issues\/(\d+)\/comments$/.exec(path);
      if (issueComments) return state.comments.get(Number(issueComments[1])) ?? [];
      const timeline = /\/issues\/(\d+)\/timeline$/.exec(path);
      if (timeline) {
        const pr = Number(timeline[1]) === 1 ? 101 : 102;
        return [{ event: "cross-referenced", source: { issue: { pull_request: { url: `https://api.github.com/repos/example/project/pulls/${pr}` } } } }];
      }
      const prFiles = /\/pulls\/(\d+)\/files$/.exec(path);
      if (prFiles) return (state.files.get(Number(prFiles[1])) ?? []).map((filename) => ({ filename }));
      if (path === `${prefix}/labels`) return [];
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      if (path.includes("/collaborators/")) {
        const login = decodeURIComponent(path.split("/collaborators/")[1].split("/")[0]);
        return { permission: login === "maintainer" ? "write" : "read" };
      }
      if (path === "/graphql") return { data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 1 }, { number: 2 }] } } } } };
      if (path === prefix) return { default_branch: "main" };
      if (method === "PATCH" && path === `${prefix}/pulls/87`) { state.patches.push(body); state.feature.body = body.body; return state.feature; }
      if (path === `${prefix}/pulls/87`) return state.feature;
      if (path === "/user") return actor;
      if (path === `${prefix}/pulls/101`) return state.pulls.get(101);
      if (path === `${prefix}/pulls/102`) return state.pulls.get(102);
      if (path === `${prefix}/issues/73`) return state.sourceIssue;
      if (path === `${prefix}/issues/1`) return state.issues[0];
      if (path === `${prefix}/issues/2`) return state.issues[1];
      if (path === `${prefix}/actions/runs/55`) return { id: 55, display_title: `Crewbie review PR #87 at ${HEAD}`, path: ".github/workflows/crewbie-review.yml", event: "workflow_dispatch", head_branch: "main", head_repository: { full_name: "example/project" }, actor, triggering_actor: actor };
      if (method === "POST" && path === `${prefix}/merges`) {
        state.merges.push(body);
        if (merge === "conflict") throw new GitHubError(409, null);
        return merge === "current" ? null : { sha: "merged" };
      }
      if (method === "POST" && path === `${prefix}/labels`) return body;
      if (method === "POST" && path === `${prefix}/issues`) {
        const issue = { ...body, number: 3 + state.created.length, state: "open", html_url: `https://github.com/example/project/issues/${3 + state.created.length}` };
        state.created.push(issue); state.issues.push(issue); state.comments.set(issue.number, []);
        return issue;
      }
      const postComment = /\/issues\/(\d+)\/comments$/.exec(path);
      if (method === "POST" && postComment) {
        const number = Number(postComment[1]);
        const comment = { id: 2000 + state.posted.length, user: actor, created_at: `p${state.posted.length}`, updated_at: `p${state.posted.length}`, body: body.body };
        state.posted.push({ issue: number, body: body.body });
        state.comments.set(number, [...state.comments.get(number) ?? [], comment]);
        return comment;
      }
      if (method === "POST" && path === `${prefix}/actions/workflows/crewbie-dispatch.yml/dispatches`) { state.dispatches.push(body); return null; }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
  state.event = (body, sender = actor, extra = {}) => ({
    action: "created", repository: { full_name: "example/project" }, sender,
    issue: { number: 87, pull_request: { url: "x" } },
    comment: { id: 999, body, user: sender, created_at: "now", updated_at: "now", ...extra },
  });
  return state;
}

test("/crewbie fix creates owner-routed tasks, conflict prerequisite, approvals, dispatch and PR-body closes", async () => {
  const f = fixFixture();
  const summary = await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie fix Please keep pizza ratings stable."));
  assert.match(summary, /created 3 fix task/);
  assert.equal(f.created.length, 3);
  const metadata = f.created.map((issue) => taskMetadata(issue.body));
  assert.deepEqual(metadata.map((item) => item.task.id), ["fix-1-conflict", "fix-1-developer", "fix-1-frontend"]);
  assert.ok(metadata.every((item) => item.batch === f.b.id && item.batchDigest === batchDigest(f.b) && item.branch === f.branch));
  assert.deepEqual(metadata[1].task.dependsOn, ["fix-1-conflict"]);
  assert.match(metadata[1].task.body, /src\/api\.ts:12[\s\S]*Please keep pizza ratings stable/);
  assert.match(metadata[2].task.body, /ui\/Button\.tsx:4/);
  assert.ok(f.created.every((issue) => issue.labels.includes("crewbie:managed") && issue.labels.includes("crewbie:blocked")));
  assert.equal(f.posted.filter((item) => item.issue >= 3 && /Crewbie approval:/.test(item.body)).length, 3);
  assert.deepEqual(f.dispatches, [{ ref: "main", inputs: { issue_numbers: "3,4,5" } }]);
  assert.match(f.patches.at(-1).body, /Closes #3[\s\S]*Closes #4[\s\S]*Closes #5/);
  assert.match(f.posted.at(-1).body, /^<!-- crewbie-fix:/);
  assert.match(f.posted.at(-1).body, /older head aaaaaaa/);
  const again = await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie fix Please keep pizza ratings stable."));
  assert.match(again, /already handled|already created/);
  assert.equal(f.created.length, 3, "same comment id is idempotent");
});

test("/crewbie fix reuses a partial source-marked round instead of creating a new round", async () => {
  const f = fixFixture();
  await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie fix Please keep pizza ratings stable."));
  const first = f.created[0];
  f.issues.splice(f.issues.indexOf(f.created[1]), 2);
  f.created.splice(1, 2);
  f.comments.set(87, f.comments.get(87).filter((comment) => !String(comment.body).startsWith("<!-- crewbie-fix:")));
  f.dispatches.splice(0); f.patches.splice(0); f.posted.splice(0);
  const summary = await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie fix Please keep pizza ratings stable."));
  assert.match(summary, /created 3 fix task/);
  assert.equal(f.created[0], first, "the existing partial issue is reused");
  assert.deepEqual(f.created.map((issue) => taskMetadata(issue.body).task.id), ["fix-1-conflict", "fix-1-developer", "fix-1-frontend"]);
  assert.deepEqual(f.dispatches, [{ ref: "main", inputs: { issue_numbers: f.created.map((issue) => issue.number).join(",") } }]);
});

test("/crewbie fix ignores forged or edited receipts", async () => {
  for (const forged of [
    { user: { login: "reader", type: "User" }, created_at: "f", updated_at: "f" },
    { user: actor, created_at: "f", updated_at: "later" },
  ]) {
    const f = fixFixture();
    const receipt = Buffer.from(JSON.stringify({ comment: 999, pr: 87, issues: [444] })).toString("base64");
    f.comments.get(87).push({ ...forged, body: `<!-- crewbie-fix:${receipt} -->\nforged` });
    const summary = await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie fix Please keep pizza ratings stable."));
    assert.match(summary, /created 3 fix task/);
    assert.equal(f.created.length, 3);
  }
});

test("/crewbie fix reports source changes before publishing paid fix tasks", async () => {
  const f = fixFixture();
  f.sourceIssue.updated_at = "source-v2";
  const result = await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie fix Please keep pizza ratings stable."));
  assert.match(result, /PRD changed since planning/);
  assert.equal(f.created.length, 0);
  assert.equal(f.dispatches.length, 0);
  assert.match(f.posted.at(-1).body, /replan or revert the edit/);
});

test("feature PR task discovery uses managed metadata beyond GitHub's first closing-reference page", async () => {
  const f = fixFixture();
  for (let index = 2; index < 25; index++) {
    const item = task(`task-${index}`);
    f.b.tasks.push(item);
    f.issues.push({ number: index + 1, state: "open", title: item.title, body: issueBody(f.b, item, { batchDigest: batchDigest(f.b), branch: f.branch }), labels: ["crewbie:managed", "crewbie:done", "crewbie:owner:developer"] });
  }
  f.feature.body = `Human edits\n\n<!-- crewbie-feature:${f.b.id} -->`;
  const feature = await featureTasks(f.client, f.cfg, f.feature);
  assert.equal(feature.tasks.length, 25);
  assert.deepEqual(feature.tasks.map((item) => item.issue.number).slice(-2), [24, 25]);
});

test("/crewbie fix rejects read-only users, bots and edited comments before writing", async () => {
  for (const event of [
    fixFixture().event("/crewbie fix", { login: "reader", type: "User" }),
    fixFixture().event("/crewbie fix", { login: "github-actions[bot]", type: "Bot" }),
    fixFixture().event("/crewbie fix", actor, { updated_at: "later" }),
  ]) {
    const f = fixFixture();
    const result = await handleFeatureFixComment(f.client, f.cfg, event);
    assert.match(result, /Only unedited|Edited comments/);
    assert.equal(f.created.length, 0);
    assert.equal(f.dispatches.length, 0);
  }
});

test("notes-only fix uses the owner with most merged changes; nothing-to-fix is acknowledged only", async () => {
  const notes = fixFixture({ merge: "current", reviewFindings: false });
  const result = await handleFeatureFixComment(notes.client, notes.cfg, notes.event("/crewbie fix Please simplify the copy."));
  assert.match(result, /created 1 fix task/);
  assert.equal(taskMetadata(notes.created[0].body).task.owner, "developer");
  assert.deepEqual(notes.dispatches, [{ ref: "main", inputs: { issue_numbers: "3" } }]);

  const nothing = fixFixture({ merge: "merged", reviewFindings: false });
  const message = await handleFeatureFixComment(nothing.client, nothing.cfg, nothing.event("/crewbie fix"));
  assert.equal(message, "Nothing to fix.");
  assert.equal(nothing.created.length, 0);
  assert.equal(nothing.dispatches.length, 0);
  assert.match(nothing.posted.at(-1).body, /nothing to fix/i);
});

test("/crewbie revise on a planning PR is left for the planning workflow", async () => {
  const f = fixFixture();
  f.feature.head.ref = "crewbie/plans/example-issue-1-1234567890abcdef";
  const message = await handleFeatureFixComment(f.client, f.cfg, f.event("/crewbie revise Split the plan."));
  assert.match(message, /planning workflow/);
  assert.equal(f.created.length, 0);
  assert.equal(f.dispatches.length, 0);
});
