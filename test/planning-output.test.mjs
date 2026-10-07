import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, fixture, task } from "./helpers.mjs";
import { parseConfig } from "../dist/config.js";
import { hash, json } from "../dist/core.js";
import { OutputValidationError, outputIssues } from "../dist/structured-output.js";
import { acceptanceCriteriaSection } from "../dist/specification/acceptance.js";
import { planningOutputSchema, readPlanningOutput, PLANNING_FILES, PLANNING_REPAIR_LIMIT } from "../dist/specification/planning-output.js";
import { analyzePlanning, planningValidationSummary } from "../dist/specification/planning-analysis.js";
import { TOOL_FREE_COPILOT_ARGS } from "../dist/setup/copilot-cli.js";

const cfg = parseConfig(config({ planning: { enabled: true, model: "planner", executeOnMerge: true } }));
const source = { number: 5, title: "Rate limiting", body: "Return HTTP 429 after the limit; reset the window every 60 seconds.", revision: "source-1", labelEvent: 77 };
const proposal = (tasks = [task("limiter")]) => ({ summary: "Implement the supplied rate limit.", questions: [], teamSuggestions: [], decisions: null, batch: { schemaVersion: 1, id: "issue-5", tasks, approval: null } });
const parse = (value, active = cfg) => readPlanningOutput(JSON.stringify(value), active, source);
const structured = () => {
  const { body: _body, ...fields } = task("limiter");
  return { ...fields, scope: "Implement the rate limiter.", acceptanceCriteria: ["Over-limit requests return HTTP 429.", "The window resets every 60 seconds."] };
};
async function analysisFixture(t, overrides = {}) {
  const input = { schemaVersion: 1, config: cfg, configHash: hash(json(cfg)), source, ...overrides };
  const root = await fixture(t, { [PLANNING_FILES.input]: json(input), [PLANNING_FILES.prompt]: "Plan the supplied rate-limit requirements using the approved planner contract." });
  const report = async () => JSON.parse(await readFile(join(root, PLANNING_FILES.report), "utf8"));
  return { root, report };
}

test("the prompt contract and validator accept structured criteria and Crewbie renders canonical Markdown", () => {
  const input = proposal([structured()]);
  assert.deepEqual(outputIssues(input, planningOutputSchema(cfg)), []);
  const { plan } = parse(input);
  assert.equal(plan.batch.tasks[0].body, "Implement the rate limiter.\n\n## Acceptance criteria\n- Over-limit requests return HTTP 429.\n- The window resets every 60 seconds.");
  assert.equal(plan.batch.tasks[0].scope, undefined);
  assert.equal(plan.batch.tasks[0].acceptanceCriteria, undefined);
  assert.deepEqual(readPlanningOutput(json(plan), cfg, source).plan, plan, "Canonical output is independently valid at publication.");
});

test("all three reported failures are recovered without inventing or losing plan text", () => {
  const note = "Consider a deployment specialist for recurring infrastructure work.";
  const decisions = "# Shared decisions\n\n- All targets use the same verified image digest. <!-- source: #5 -->\n";
  const original = proposal([{ ...task("review"), kind: "review", body: "Review the release.\n\n## Acceptance criteria (findings that block)\n- Report every digest mismatch." }]);
  original.teamSuggestions = [{ note }];
  original.decisions = { path: ".crewbie/decisions/hot.md", content: decisions };
  const before = structuredClone(original);
  const { plan, normalizations } = parse(original);
  assert.deepEqual(original, before, "Reading output does not mutate the caller's proposal.");
  assert.deepEqual(plan.teamSuggestions, [note]);
  assert.equal(plan.decisions, decisions);
  assert.equal(plan.batch.tasks[0].body, original.batch.tasks[0].body);
  assert.deepEqual(normalizations.map(({ path }) => path), ["$.teamSuggestions[0]", "$.decisions"]);
  assert.equal(acceptanceCriteriaSection(plan.batch.tasks[0].body).trim(), "- Report every digest mismatch.");
});

test("ambiguous wrappers, empty criteria and contradictory body representations are rejected", () => {
  for (const [input, path] of [
    [{ ...proposal(), teamSuggestions: [{ note: "Preserve this.", reason: "Also preserve this." }] }, "$.teamSuggestions[0]"],
    [{ ...proposal(), decisions: { path: ".crewbie/decisions/hot.md", content: "Keep this.", other: "Must not be discarded." } }, "$.decisions"],
    [proposal([{ ...structured(), acceptanceCriteria: [] }]), "$.batch.tasks[0].acceptanceCriteria"],
    [proposal([{ ...structured(), body: "Conflicting task body." }]), "$.batch.tasks[0]"],
    [proposal([{ ...structured(), scope: "## Acceptance criteria\n- Contradictory criteria." }]), "$.batch.tasks[0].scope"],
  ]) assert.throws(() => parse(input), (error) => error instanceof OutputValidationError && error.issues.some((issue) => issue.path === path));
});

test("headings inside examples/comments do not satisfy acceptance criteria, and multiline criteria stay in their bullet", () => {
  assert.equal(acceptanceCriteriaSection("```md\n## Acceptance criteria\n- example\n```"), null);
  assert.equal(acceptanceCriteriaSection("<!--\n## Acceptance criteria\n-->"), null);
  const annotated = "## Acceptance criteria (review)\r\n- Real check\r\n```md\r\n## Example only\r\n```\r\n## Handoff\r\nDone.";
  assert.equal(acceptanceCriteriaSection(annotated), "- Real check\r\n```md\r\n## Example only\r\n```\r\n");
  const candidate = structured();
  candidate.acceptanceCriteria = ["Check the response.\n## This is part of the criterion"];
  assert.match(parse(proposal([candidate])).plan.batch.tasks[0].body, /- Check the response\.\n  ## This is part of the criterion/);
  assert.throws(() => parse(proposal([{ ...task("empty"), body: "## Acceptance criteria\n\n## Handoff\nDone." }])), /non-empty acceptance criteria/);
  assert.throws(() => parse(proposal([{ ...task("comment"), body: "## Acceptance criteria\n<!-- No observable criteria here. -->" }])), /non-empty acceptance criteria/);
});

test("validation reports independent field errors together and does not echo rejected data", () => {
  const input = proposal([{ ...task("limiter"), priority: "not-an-integer" }, { ...task("other"), dependsOn: "not-a-list" }]);
  input.questions = [123];
  input.teamSuggestions = [{ unknown: "untrusted-secret-data" }];
  assert.throws(() => parse(input), (error) => {
    assert.ok(error instanceof OutputValidationError);
    const paths = error.issues.map(({ path }) => path);
    for (const path of ["$.questions[0]", "$.teamSuggestions[0]", "$.batch.tasks[0].priority", "$.batch.tasks[1].dependsOn"]) assert.ok(paths.includes(path));
    assert.doesNotMatch(error.message, /untrusted-secret-data|not-an-integer/);
    return true;
  });
});

test("word budgets, missing headings and dependency failures remain enforced and aggregated", () => {
  const active = parseConfig({ ...cfg, limits: { ...cfg.limits, spec: 60 } });
  const input = proposal([
    { ...task("long"), body: "word ".repeat(80), dependsOn: ["missing"] },
    { ...task("cycle"), dependsOn: ["cycle"] },
  ]);
  assert.throws(() => parse(input, active), (error) => {
    assert.match(error.message, /exceeds 60 words/);
    assert.match(error.message, /Acceptance criteria heading/);
    assert.match(error.message, /Missing dependency: missing/);
    assert.match(error.message, /Dependency cycle/);
    assert.ok(error.issues.some(({ path }) => path === "$.batch.tasks[0].body"));
    return true;
  });
});

test("clarification plans remain valid while empty plans and excess tasks are rejected", () => {
  assert.equal(parse({ ...proposal(), batch: null, questions: ["What is the request limit?"] }).plan.batch, null);
  assert.throws(() => parse({ ...proposal(), batch: null }), /clarification/);
  assert.throws(() => parse(proposal(Array.from({ length: 9 }, (_, i) => task(`task-${i}`)))), /at most 8/);
});

test("analysis normalizes the recorded formatting failures in one call and saves evidence", async (t) => {
  const f = await analysisFixture(t);
  const candidate = proposal([{ ...task("review"), body: "## Acceptance criteria (findings that block)\n- Report each failure." }]);
  candidate.teamSuggestions = [{ note: "Consider a platform specialist." }];
  candidate.decisions = { path: ".crewbie/decisions/hot.md", content: "# Shared decisions\n\n- Reuse the existing identity.\n" };
  let calls = 0;
  const raw = "```json\n" + JSON.stringify(candidate) + "\n```";
  await analyzePlanning(f.root, async (_prompt, model) => { calls++; assert.equal(model, cfg.planning.model); return raw; });
  assert.equal(calls, 1);
  const output = await readFile(join(f.root, PLANNING_FILES.output), "utf8");
  const canonical = JSON.parse(output);
  assert.deepEqual(canonical.teamSuggestions, ["Consider a platform specialist."]);
  assert.equal(canonical.decisions, candidate.decisions.content);
  assert.equal((await f.report()).status, "valid");
  assert.equal((await f.report()).attempts[0].normalizations.length, 2);
  assert.equal(await readFile(join(f.root, ".crewbie-planning-attempt-1.txt"), "utf8"), raw);
});

test("an invalid response is corrected within the same analysis using field diagnostics and original requirements", async (t) => {
  const f = await analysisFixture(t, { revision: { feedback: "Preserve the existing X-RateLimit-Reset header." } });
  const bad = proposal();
  bad.teamSuggestions = [false];
  bad.questions = [123];
  const prompts = [];
  await analyzePlanning(f.root, async (prompt) => {
    prompts.push(prompt);
    return JSON.stringify(prompts.length === 1 ? bad : proposal([structured()]));
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /\$\.teamSuggestions\[0\]/);
  assert.match(prompts[1], /\$\.questions\[0\]/);
  assert.match(prompts[1], /HTTP 429/);
  assert.match(prompts[1], /60 seconds/);
  assert.match(prompts[1], /Preserve the existing X-RateLimit-Reset header/);
  assert.match(prompts[1], /Preserve the proposed task scope/);
  const report = await f.report();
  assert.deepEqual(report.attempts.map(({ status }) => status), ["invalid", "valid"]);
  assert.equal(report.attempts[0].inputHash, hash(prompts[0]));
  assert.match(planningValidationSummary(report), /Model calls: 2/);
});

test("repeated invalid output has a fixed request ceiling and downloadable diagnostics", async (t) => {
  const f = await analysisFixture(t);
  let calls = 0;
  await assert.rejects(analyzePlanning(f.root, async () => { calls++; return "Not JSON"; }), /failed validation after 3 model call/);
  assert.equal(calls, 1 + PLANNING_REPAIR_LIMIT);
  const report = await f.report();
  assert.equal(report.status, "invalid");
  assert.equal(report.attempts.length, 3);
  assert.ok(report.attempts.every(({ issues }) => issues.length > 0));
  assert.equal(await readFile(join(f.root, ".crewbie-planning-attempt-3.txt"), "utf8"), "Not JSON");
});

test("operators can disable model corrections without disabling normalization", async (t) => {
  const active = parseConfig({ ...cfg, planning: { ...cfg.planning, maxFormatRepairs: 0 } });
  const f = await analysisFixture(t, { config: active, configHash: hash(json(active)) });
  let calls = 0;
  await assert.rejects(analyzePlanning(f.root, async () => { calls++; return "Not JSON"; }), /after 1 model call/);
  assert.equal(calls, 1);
  assert.equal((await f.report()).maxRepairs, 0);
  const candidate = { ...proposal(), teamSuggestions: [{ note: "Consider a specialist." }] };
  await analyzePlanning(f.root, async () => { calls++; return JSON.stringify(candidate); });
  assert.equal(calls, 2);
  assert.equal((await f.report()).attempts.length, 1);
  assert.equal((await f.report()).status, "valid");
  for (const maxFormatRepairs of [-1, 3, 1.5, "2"]) {
    assert.throws(() => parseConfig({ ...cfg, planning: { ...cfg.planning, maxFormatRepairs } }), /maxFormatRepairs/);
  }
});

test("unsafe proposals are rejected immediately, with no repair that can erase them", async (t) => {
  const unsafe = [
    { ...proposal(), batch: { ...proposal().batch, approval: { execute: true, digest: "self-approved" } } },
    proposal([{ ...task("limiter"), model: "unapproved-model" }]),
    proposal([{ ...task("limiter"), adoWorkItem: 123 }]),
    { ...proposal(), decisions: { path: "app/server.ts", content: "write elsewhere" } },
    { ...proposal(), summary: "github_pat_" + "a".repeat(30) },
  ];
  for (const candidate of unsafe) {
    const f = await analysisFixture(t);
    let calls = 0;
    await assert.rejects(analyzePlanning(f.root, async () => { calls++; return JSON.stringify(candidate); }));
    assert.equal(calls, 1);
    assert.equal((await f.report()).status, "invalid");
    assert.doesNotMatch(await readFile(join(f.root, ".crewbie-planning-attempt-1.txt"), "utf8"), /github_pat_a{30}/);
  }
  const partial = await analysisFixture(t);
  let calls = 0;
  await assert.rejects(analyzePlanning(partial.root, async () => { calls++; return "Incomplete JSON with github_pat_" + "a".repeat(30) + " {"; }), /secret/);
  assert.equal(calls, 1, "Malformed JSON containing credentials cannot be sent back for correction.");
  assert.doesNotMatch(await readFile(join(partial.root, ".crewbie-planning-attempt-1.txt"), "utf8"), /github_pat_a{30}/);
});

test("transport failure is not retried and cannot leave a stale valid proposal behind", async (t) => {
  const f = await analysisFixture(t);
  await writeFile(join(f.root, PLANNING_FILES.output), JSON.stringify(proposal()));
  let calls = 0;
  await assert.rejects(analyzePlanning(f.root, async () => { calls++; throw new Error("Service unavailable."); }), /no automatic retry/);
  assert.equal(calls, 1);
  assert.equal((await f.report()).status, "runtime_error");
  await assert.rejects(readFile(join(f.root, PLANNING_FILES.output)), /ENOENT/);
});

test("changed config and oversized prompts/outputs stop without truncation or extra requests", async (t) => {
  const changed = await analysisFixture(t, { configHash: "old" });
  await assert.rejects(analyzePlanning(changed.root, async () => { throw new Error("Must not call a model."); }), /approved configuration snapshot/);
  assert.equal((await changed.report()).attempts.length, 0);
  const oversized = await analysisFixture(t);
  await writeFile(join(oversized.root, PLANNING_FILES.prompt), "x".repeat(100001));
  await assert.rejects(analyzePlanning(oversized.root, async () => { throw new Error("Must not call a model."); }), /100 KB/);
  assert.equal((await oversized.report()).attempts.length, 0);
  const output = await analysisFixture(t);
  let calls = 0;
  await assert.rejects(analyzePlanning(output.root, async () => { calls++; return "x".repeat(100001); }), /100 KB/);
  assert.equal(calls, 1);
  await assert.rejects(readFile(join(output.root, PLANNING_FILES.output)), /ENOENT/);
});

test("the planning transport keeps tools, custom instructions and builtin MCPs disabled", () => {
  assert.equal(TOOL_FREE_COPILOT_ARGS.join(" "), "--no-custom-instructions --disable-builtin-mcps --available-tools --silent --deny-tool shell write url");
});
