import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../dist/config.js";
import { memoryLimit } from "../dist/memory/context.js";
import { overBudget, prMemoryBudgets } from "../dist/memory/budget.js";
import { armTasks, compareArms, renderComparison } from "../dist/reporting/ablation.js";
import { config } from "./helpers.mjs";

test("memory budgets apply to always-loaded and topic memory, not to other files", () => {
  const cfg = parseConfig(config());
  assert.equal(memoryLimit(cfg, ".crewbie/instructions.md"), 600);
  assert.equal(memoryLimit(cfg, ".crewbie/decisions/hot.md"), memoryLimit(cfg, ".crewbie/team/developer/hot.md"));
  assert.ok(memoryLimit(cfg, ".crewbie/team/developer/cold/seed-data.md") > 0);
  assert.ok(memoryLimit(cfg, ".crewbie/decisions/archive/money.md") > 0);
  for (const path of [".crewbie/team/developer/index.md", ".crewbie/rationale.md", "src/app.ts", ".crewbie/team/../hot.md"]) assert.equal(memoryLimit(cfg, path), null, path);
});

test("the PR check reads changed memory at the PR head and reports, never blocks, an exceeded budget", async () => {
  const cfg = parseConfig(config());
  const limit = memoryLimit(cfg, ".crewbie/team/developer/hot.md");
  const files = {
    ".crewbie/team/developer/hot.md": "- lesson ".repeat(limit),
    ".crewbie/instructions.md": "Shared rules.",
  };
  const reads = [];
  const client = {
    async list(path) {
      assert.equal(path, "/repos/example/project/pulls/7/files");
      return [
        { filename: ".crewbie/team/developer/hot.md", status: "modified" },
        { filename: ".crewbie/instructions.md", status: "modified" },
        { filename: ".crewbie/decisions/hot.md", status: "removed" },
        { filename: "src/app.ts", status: "modified" },
      ];
    },
    async request(_method, path) {
      reads.push(path);
      const file = decodeURIComponent(path.split("/contents/")[1].split("?")[0]);
      return { type: "file", encoding: "base64", content: Buffer.from(files[file]).toString("base64") };
    },
  };
  const budgets = await prMemoryBudgets(client, cfg, { number: 7, head: { sha: "head-sha" } });
  assert.deepEqual(budgets.map((budget) => budget.path), [".crewbie/team/developer/hot.md", ".crewbie/instructions.md"]);
  assert.ok(reads.every((path) => path.endsWith("?ref=head-sha")), "Budgets are read at the PR head, not the base.");
  assert.match(overBudget(budgets), /developer\/hot\.md \(\d+\/\d+ words\).*does not block the PR/);
  assert.doesNotMatch(overBudget(budgets), /instructions\.md/);
  files[".crewbie/team/developer/hot.md"] = "- A lesson.";
  assert.equal(overBudget(await prMemoryBudgets(client, cfg, { number: 7, head: { sha: "head-sha" } })), null);
  files[".crewbie/team/developer/hot.md"] = `- A lesson. <!-- ${"source ".repeat(2000)} -->`;
  assert.deepEqual((await prMemoryBudgets(client, cfg, { number: 7, head: { sha: "head-sha" } }))[0].words, 3, "Source comments do not count toward the budget.");
  assert.match(overBudget([{ path: ".crewbie/decisions/hot.md", words: Number.MAX_SAFE_INTEGER, limit: 600 }]), /too large to read/);
});

const attributed = (tokens) => `<!-- crewbie-attribution -->\n**Observed tokens:** ${tokens}; 1/1 known sessions.\n<!-- /crewbie-attribution -->`;

test("evaluation reads only task PRs into Crewbie feature branches and keeps unknown usage unknown", async () => {
  const client = { async list(path) {
    assert.equal(path, "/repos/owner/guided/pulls?state=all");
    return [
      { number: 1, base: { ref: "crewbie/feature-a" }, merged_at: "2026-01-01T00:00:00Z", body: attributed("1000 (900 input + 100 output)") },
      { number: 2, base: { ref: "crewbie/feature-a" }, merged_at: null, body: attributed("unavailable") },
      { number: 3, base: { ref: "main" }, merged_at: "2026-01-01T00:00:00Z", body: attributed("50 (40 input + 10 output)") },
      { number: 4, base: { ref: "crewbie/feature-b" }, merged_at: "2026-01-01T00:00:00Z", body: null },
    ];
  } };
  const all = await armTasks(client, "owner/guided", "guided");
  assert.deepEqual(all.map((task) => [task.pr, task.merged, task.tokens]), [[1, true, 1000], [2, false, null], [4, true, null]]);
  assert.deepEqual((await armTasks(client, "owner/guided", "guided", "crewbie/feature-a")).map((task) => task.pr), [1, 2]);
  await assert.rejects(armTasks(client, "not a repo", "guided"), /owner\/name/);
});

test("evaluation compares success and cost per merged task, and flags guidance that costs without helping", () => {
  const task = (arm, pr, merged, tokens) => ({ arm, repository: `owner/${arm}`, pr, feature: "crewbie/f", merged, tokens });
  const tasks = [
    ...[1, 2, 3, 4, 5].map((pr) => task("guided", pr, pr !== 5, 3000)),
    ...[1, 2, 3, 4, 5].map((pr) => task("bare", pr, pr !== 5, 2000)),
  ];
  const result = compareArms("owner/guided", "owner/bare", tasks);
  assert.equal(result.guided.successRate, 0.8);
  assert.equal(result.guided.tokensPerMerge, 3750);
  assert.equal(result.bare.tokensPerMerge, 2500);
  assert.match(result.verdict, /same share.*3750 vs 2500.*\+50%.*costs context without improving outcomes/);
  assert.ok(!result.caveats.some((caveat) => /Fewer than five/.test(caveat)));
  const text = renderComparison(result);
  assert.match(text, /\| guided \| `owner\/guided` \| 4\/5 \(80%\) \| 5\/5 \| 15000 \| 3750 \|/);

  const partial = compareArms("owner/guided", "owner/bare", [task("guided", 1, true, 100), task("guided", 2, true, null), task("bare", 1, false, 50)]);
  assert.equal(partial.guided.tokensPerMerge, null, "A partial total would flatter the arm with gaps.");
  assert.match(partial.verdict, /Guidance merged 100 percentage points more tasks, token cost per merged task is unavailable/);
  assert.ok(partial.caveats.some((caveat) => /different task counts/.test(caveat)));
  assert.ok(partial.caveats.some((caveat) => /Fewer than five/.test(caveat)));
  assert.ok(partial.caveats.some((caveat) => /guided arm: 1 of 2 PRs have no measured tokens/.test(caveat)));
  assert.match(renderComparison(partial), /\| unavailable \|/);
  assert.match(compareArms("owner/guided", "owner/bare", []).verdict, /Not comparable/);
});

import { demoteBranchMemory, demoteEntries } from "../dist/memory/demote.js";
import { visibleWords, withoutComments } from "../dist/core.js";
import { SHARED_INSTRUCTIONS } from "../dist/setup/templates.js";

test("demotion moves the oldest hot entries with their continuation lines and keeps headings", () => {
  const entries = Array.from({ length: 30 }, (_, i) => `- Entry ${i} ${"word ".repeat(8)}see [pr](../../src/a${i}.ts)\n  continued ${i}`);
  const hot = `# Hot\n\nIntro prose.\n\n${entries.join("\n")}\n`;
  assert.equal(demoteEntries(hot, 10_000), null, "Within budget is untouched.");
  const result = demoteEntries(hot, 200);
  assert.ok(result.moved.length > 0);
  assert.match(result.moved[0], /^- Entry 0 [\s\S]*continued 0$/);
  assert.match(result.hot, /^# Hot\n\nIntro prose\./);
  assert.ok(result.hot.split(/\s+/).filter(Boolean).length <= 160);
  assert.match(result.hot, /Entry 29/, "Newest entries stay hot.");
  assert.doesNotMatch(result.hot, /Entry 0 /);
  assert.equal(demoteEntries(`# Hot\n\n${"prose ".repeat(300)}`, 100), null, "Nothing movable: leave it.");
  assert.equal(demoteEntries(`# Hot\n\n- Entry <!-- ${"source ".repeat(300)} -->\n`, 100), null, "Comments do not push hot memory over budget.");
});

test("comments are removed outside code; inline and fenced code keep them", () => {
  const text = "# Hot\n<!-- whole line -->\n- Rule, because reason. <!-- source: #4 -->\n- Multi <!-- a\nb --> line\n- Example: `- x <!-- source: #1 -->`\n```html\n<!-- kept -->\n```\n";
  assert.equal(withoutComments(text), "# Hot\n- Rule, because reason.\n- Multi line\n- Example: `- x <!-- source: #1 -->`\n```html\n<!-- kept -->\n```\n");
  assert.equal(visibleWords("- Rule. <!-- one two three -->"), 2);
  assert.equal(withoutComments("Unclosed <!-- stays"), "Unclosed <!-- stays");
  assert.match(withoutComments(SHARED_INSTRUCTIONS), /`- Seed data resets on restart, so tests create users\. <!-- source: #42 2026-09-29 -->`/, "The shared rules' format example survives launch stripping.");
});

function repo(files, { failPatch = false } = {}) {
  const writes = [];
  return { writes, client: {
    async request(method, path, body) {
      if (method === "GET" && path.includes("/contents/")) {
        const [file, query] = path.split("/contents/")[1].split("?");
        const name = decodeURIComponent(file);
        assert.match(query, /ref=crewbie%2Ffeature/);
        if (!(name in files)) { const error = new (await import("../dist/core.js")).GitHubError(404, null); throw error; }
        return { type: "file", encoding: "base64", content: Buffer.from(files[name]).toString("base64") };
      }
      if (method === "GET" && path.endsWith("/git/ref/heads/crewbie/feature")) return { object: { sha: "head" } };
      if (method === "GET" && path.endsWith("/git/commits/head")) return { tree: { sha: "tree" } };
      if (method === "POST" && path.endsWith("/git/trees")) { writes.push(body); return { sha: "new-tree" }; }
      if (method === "POST" && path.endsWith("/git/commits")) { assert.deepEqual(body.parents, ["head"]); return { sha: "new-commit" }; }
      if (method === "PATCH" && path.endsWith("/git/refs/heads/crewbie/feature")) {
        assert.deepEqual(body, { sha: "new-commit", force: false });
        if (failPatch) { const { GitHubError } = await import("../dist/core.js"); throw new GitHubError(422, null); }
        return {};
      }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  } };
}

test("launch demotion commits oldest hot entries to a linked cold topic on the feature branch only", async () => {
  const cfg = parseConfig(config());
  const limit = memoryLimit(cfg, ".crewbie/decisions/hot.md");
  const big = `# Decisions\n\n${Array.from({ length: limit / 5 }, (_, i) => `- Choice ${i} uses [adr](../../docs/adr${i}.md) and https://x.test/${i}`).join("\n")}\n`;
  const files = {
    ".crewbie/decisions/hot.md": big,
    ".crewbie/decisions/index.md": "# Decisions index\n",
    ".crewbie/decisions/cold/earlier-2026-01-02.md": "taken",
    ".crewbie/team/developer/hot.md": "- Small.\n",
  };
  const { client, writes } = repo(files);
  assert.deepEqual(await demoteBranchMemory(client, cfg, "developer", "main", "2026-01-02"), [], "Default branch is never rewritten.");
  assert.deepEqual(await demoteBranchMemory(client, cfg, "developer", "copilot/fix-1", "2026-01-02"), []);
  assert.deepEqual(await demoteBranchMemory(client, cfg, "developer", "crewbie/feature", "2026-01-02"), [".crewbie/decisions/hot.md"]);
  const tree = writes[0];
  assert.equal(tree.base_tree, "tree");
  const byPath = Object.fromEntries(tree.tree.map((entry) => [entry.path, entry.content]));
  const cold = byPath[".crewbie/decisions/cold/earlier-2026-01-02-2.md"];
  assert.ok(cold, "An existing topic name is not overwritten.");
  assert.match(cold, /- Choice 0 uses \[adr\]\(\.\.\/\.\.\/\.\.\/docs\/adr0\.md\) and https:\/\/x\.test\/0/);
  assert.match(byPath[".crewbie/decisions/index.md"], /^# Decisions index\n- \[Earlier entries: Choice 0 uses adr and/);
  assert.match(byPath[".crewbie/decisions/index.md"], /\]\(cold\/earlier-2026-01-02-2\.md\)/);
  assert.ok(byPath[".crewbie/decisions/hot.md"].split(/\s+/).filter(Boolean).length <= limit);
  assert.doesNotMatch(byPath[".crewbie/decisions/hot.md"], /Choice 0 /);
  assert.equal(byPath[".crewbie/team/developer/hot.md"], undefined);
  const failing = repo(files, { failPatch: true });
  assert.deepEqual(await demoteBranchMemory(failing.client, cfg, "developer", "crewbie/feature", "2026-01-02"), [], "A moved branch skips demotion instead of failing the launch.");
});
