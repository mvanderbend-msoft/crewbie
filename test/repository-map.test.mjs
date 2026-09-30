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

test("Swift packages and Xcode projects identify their owning directories without duplicate workspaces", () => {
  const native = repositoryMap([
    "ios/LibbyCore/Package.swift", "ios/LibbyCore/Sources/Core.swift",
    "ios/Libby.xcodeproj/project.pbxproj", "ios/Libby.xcworkspace/contents.xcworkspacedata",
    "ios/Libby.xcodeproj/project.xcworkspace/contents.xcworkspacedata",
    "ios/Package.swift", "mac/App.xcodeproj/project.pbxproj",
    "shared/Package.swift", "shared/package.json",
  ]);
  assert.deepEqual(native.workspaces, ["ios", "ios/LibbyCore", "mac", "shared"]);
  assert.deepEqual(promptMap(native).workspaces, native.workspaces);
  assert.deepEqual(unownedWorkspaces(native, ["Own ios and its LibbyCore package.", "Own shared."]), ["mac"]);
});

test("root native projects and Xcode bundle internals do not invent nested workspaces", () => {
  const native = repositoryMap([
    "Package.swift", "Libby.xcodeproj/project.pbxproj", "Libby.xcworkspace/contents.xcworkspacedata",
    "Libby.xcodeproj/project.xcworkspace/contents.xcworkspacedata",
    "Libby.xcodeproj/metadata/Package.swift", "Libby.xcworkspace/metadata/package.json",
    "ios/Libby.xcodeproj/metadata/Nested.xcodeproj/project.pbxproj",
    "ios/Libby.xcworkspace/metadata/Nested.xcworkspace/contents.xcworkspacedata",
    "ios/project.pbxproj", "ios/contents.xcworkspacedata", "ios/package.swift",
    "ios/Fake.xcodeproj/README.md", "ios/Fake.xcworkspace/README.md",
  ]);
  assert.deepEqual(native.workspaces, []);
});

test("native project discovery preserves dependency, build, fixture and example exclusions", () => {
  const native = repositoryMap([
    "vendor/Native/Package.swift", "node_modules/Native/App.xcodeproj/project.pbxproj",
    "ios/build/App.xcodeproj/project.pbxproj", "dist/App.xcworkspace/contents.xcworkspacedata",
    "fixtures/App.xcodeproj/project.pbxproj", "test/Native/Package.swift",
    "tests/Native/App.xcworkspace/contents.xcworkspacedata", "__tests__/Native/Package.swift",
    "examples/App.xcodeproj/project.pbxproj", "example/Native/Package.swift",
    "ios/Native/Package.swift",
  ]);
  assert.deepEqual(native.workspaces, ["ios/Native"]);
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
