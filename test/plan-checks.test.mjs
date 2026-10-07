import test from "node:test";
import assert from "node:assert/strict";
import { contractValues, planChecks, renderPlanChecks } from "../dist/specification/plan-checks.js";
import { repositoryMap } from "../dist/setup/repository-map.js";

const task = (id, body, extra = {}) => ({ id, title: id, body, owner: "developer", model: "m", priority: 1, dependsOn: [], ...extra });
const batch = (tasks) => ({ schemaVersion: 1, id: "issue-1", spec: "x", sources: [], tasks, approval: null });

test("contract values normalize status codes and quantities without catching ordinary numbers", () => {
  assert.deepEqual(contractValues("Return HTTP 429 after 100 requests in 60 seconds; 404 Not Found otherwise. Node 20, step 3.").sort(), ["60s", "HTTP 404", "HTTP 429"]);
  assert.deepEqual(contractValues("Cache for 5 min, respond with a 201 within 250ms.").sort(), ["250ms", "5min", "HTTP 201"]);
});

test("plan checks flag invented values, dropped PRD values, overlapping criteria and missing paths", () => {
  const map = repositoryMap(["src/app.ts", "src/api/users.ts"]);
  const source = "Rate limit: respond with HTTP 429 after the limit, and reset the window every 60 seconds.";
  const warnings = planChecks(batch([
    task("contract", "Define the limiter in `src/limits/` returning status 503.\n\n## Acceptance criteria\n- Requests over the limit are rejected with a clear error\n- Existing behavior remains covered by relevant tests."),
    task("tests", "Test it in `src/api/users.ts`.\n\n## Acceptance criteria\n- Requests over the limit are rejected with clear error\n- Existing behavior remains covered by relevant tests."),
    task("review", "## Acceptance criteria\n- Requests over the limit are rejected with a clear error", { kind: "review" }),
  ]), source, map);
  const text = warnings.join("\n");
  assert.match(text, /`contract` states values the source issue does not: HTTP 503/);
  assert.match(text, /no task carries: HTTP 429, 60s/);
  assert.match(text, /`contract` and `tests` share an acceptance criterion/);
  assert.doesNotMatch(text, /`review`/, "Review tasks legitimately restate what they verify.");
  assert.match(text, /`contract` cites paths not in the repository: `src\/limits\/`/);
  assert.doesNotMatch(text, /users\.ts/);
  assert.match(renderPlanChecks(warnings), /^## Plan checks/);
  assert.equal(renderPlanChecks([]), "");
});

test("a plan that carries the PRD's values into distinct tasks has no warnings", () => {
  const warnings = planChecks(batch([
    task("limiter", "## Acceptance criteria\n- Over-limit requests get HTTP 429\n- The window resets every 60 seconds"),
    task("docs", "## Acceptance criteria\n- The README documents the rate limit headers"),
  ]), "Return HTTP 429; reset every 60 s.", repositoryMap(["README.md"]));
  assert.deepEqual(warnings, []);
});

test("annotated Acceptance criteria headings are read consistently by validation and advisory checks", () => {
  const warnings = planChecks(batch([
    task("first", "## Acceptance criteria (findings that block)\n- Requests over the limit return a clear error"),
    task("second", "# Acceptance criteria\n- Requests over the limit return a clear error"),
  ]), "Keep requests bounded.", repositoryMap([]));
  assert.ok(warnings.some((warning) => warning.includes("share an acceptance criterion")));
});
