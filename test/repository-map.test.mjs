import test from "node:test";
import assert from "node:assert/strict";
import { missingPaths, pathReferences, promptMap, repositoryMap, unownedWorkspaces } from "../dist/setup/repository-map.js";

const map = repositoryMap([
  "package.json", "src/app.ts", "src/billing/invoice.ts", "packages/api/package.json", "packages/api/src/index.ts",
  "packages/web/package.json", "packages/web/src/main.tsx", "test/fixtures/demo/package.json", "AGENTS.md",
]);

test("the repository map lists directories and manifest workspaces without contents, and does not serialize file lists", () => {
  assert.deepEqual(map.workspaces, ["packages/api", "packages/web"], "Fixtures and the root are not workspaces.");
  assert.ok(map.directories.includes("src/billing"));
  assert.equal(JSON.parse(JSON.stringify(map)).files, undefined, "Saved proposals do not carry the full file list.");
  assert.deepEqual(promptMap(map).workspaces, ["packages/api", "packages/web"]);
});

test("path references ignore prose pairs, URLs and routes but catch code spans and path-shaped words", () => {
  const refs = pathReferences("Own `src/legacy/` and src/billing/invoice.ts, see https://example.com/a/b.ts, and/or input/output, route /api/users, frontend/backend, `packages/web`.", new Set(["packages"]));
  assert.deepEqual(refs.sort(), ["packages/web", "src/billing/invoice.ts", "src/legacy/"]);
});

test("module specifiers, placeholders, slash-joined words and workspace-relative paths are not reported", () => {
  assert.deepEqual(missingPaths(map, "Use `node:assert/strict`, `@shop/shared`, `add/list/complete`, `Status/Context/Decision`, `docs/adr/NNNN-title.md`, `src/<module>.ts` and `src/main.tsx`."), []);
  assert.deepEqual(missingPaths(map, "`packages/mobile` and `src/billing/gone.ts`"), ["packages/mobile", "src/billing/gone.ts"]);
});

test("path extraction stays linear on pathological input", () => {
  const started = Date.now();
  pathReferences("a.".repeat(100_000));
  assert.ok(Date.now() - started < 1000);
});

test("missing paths are reported against the working tree, excluding files the proposal creates and Crewbie output", () => {
  assert.deepEqual(missingPaths(map, "Edit `src/legacy/` and `src/billing/*.ts`, `src/app.ts`, `.crewbie/team/x.md`, `docs/new.md`", ["docs/new.md"]), ["src/legacy/"]);
  assert.deepEqual(missingPaths(JSON.parse(JSON.stringify(map)), "`src/legacy/`"), [], "A reloaded map without files cannot prove absence.");
});

test("workspaces are owned only when a role names their path or directory name", () => {
  assert.deepEqual(unownedWorkspaces(map, ["Owns the packages/api service.", "Reviews everything."]), ["packages/web"]);
  assert.deepEqual(unownedWorkspaces(map, ["Owns api.", "Owns the web client."]), []);
});
