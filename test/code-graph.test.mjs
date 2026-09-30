import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, open, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, relative } from "node:path";
import { collectCodeGraph, summarizeCodeGraph } from "../dist/setup/code-graph.js";
import { workingTree } from "../dist/setup/repository-map.js";
import { fixture } from "./helpers.mjs";

async function snapshotFiles(root) {
  const paths = await readdir(root, { recursive: true });
  const files = [];
  for (const path of paths) if ((await stat(join(root, path))).isFile()) files.push(path.replaceAll("\\", "/"));
  return files.sort();
}

function fileGraph(snapshot, paths) {
  return { nodes: paths.map((path) => ({ kind: "File", file_path: join(snapshot, path), qualified_name: join(snapshot, path) })), edges: [] };
}

function transport({ version = "code-review-graph 2.3.9", status = { build_incomplete: false }, buildOutput = "", exported, writeExport, onCall } = {}) {
  const calls = [];
  return {
    calls,
    options: {
      executable: process.execPath,
      run: async (executable, args, options) => {
        calls.push({ executable, args, ...options });
        await onCall?.(args, options);
        if (args[0] === "--version") return version;
        if (args[0] === "build") return buildOutput;
        if (args[0] === "status") return typeof status === "string" ? status : JSON.stringify(status);
        if (args[0] === "visualize") {
          const snapshot = args[args.indexOf("--repo") + 1];
          const data = args[args.indexOf("--data-dir") + 1];
          if (writeExport) {
            await writeExport(join(data, "graph.json"), snapshot);
            return "";
          }
          const value = exported === undefined ? fileGraph(snapshot, await snapshotFiles(snapshot))
            : typeof exported === "function" ? await exported(snapshot) : exported;
          await writeFile(join(data, "graph.json"), typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
        }
        return "";
      },
    },
  };
}

async function writePaddedExport(path, prefix, suffix) {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(prefix);
    // Cross the former 16 MB limit without allocating an entire export in memory.
    const padding = " ".repeat(1_000_000);
    for (let index = 0; index < 17; index++) await handle.writeFile(padding);
    await handle.writeFile(suffix);
  } finally { await handle.close(); }
}

const metadata = (overrides = {}) => ({
  version: "2.3.9", collectedAt: "2026-09-29T12:00:00.000Z", snapshotHash: "a".repeat(64), candidates: 2, partial: false, ...overrides,
});

test("CodeGraph snapshots only supplied eligible sources and never repository configuration, hidden or ignored files", async (t) => {
  const root = await fixture(t, {
    "src/app.ts": "export const sourceSentinel = 'SOURCE_BODY_NOT_SENT';",
    "ios/App.swift": "struct App {}",
    "ignored.swift": "IGNORED_SOURCE_NOT_READ",
    ".gitignore": "ignored.swift\n",
    ".hidden/config.py": "HIDDEN_SOURCE_NOT_READ",
    ".code-review-graph/config.json": '{"command":"DO_NOT_RUN"}',
    ".mcp.json": '{"command":"DO_NOT_RUN"}',
    "node_modules/dependency/index.js": "DEPENDENCY_NOT_READ",
    "Pods/Framework/App.swift": "DEPENDENCY_NOT_READ",
    "build/App.swift": "GENERATED_NOT_READ",
    "ios/Shader.metal": "UNSUPPORTED_SHADER_NOT_READ",
    "ios/App.xcodeproj/project.pbxproj": "BUILD_SETTINGS_NOT_READ",
    "package.json": '{"scripts":{"postinstall":"DO_NOT_RUN"}}',
  });
  const runner = transport({ onCall: async (args) => {
    if (args[0] !== "build") return;
    const snapshot = args[args.indexOf("--repo") + 1];
    assert.deepEqual(await snapshotFiles(snapshot), ["ios/App.swift", "src/app.ts"]);
    assert.equal(await readFile(join(snapshot, "src/app.ts"), "utf8"), "export const sourceSentinel = 'SOURCE_BODY_NOT_SENT';");
    assert.ok(args.includes("--skip-postprocess"));
  } });
  const report = await collectCodeGraph(root, workingTree(root).files, runner.options);
  assert.deepEqual(report.coverage, { candidates: 2, copied: 2, indexed: 2, omitted: 0, unindexed: 0, partial: false });
  assert.deepEqual(report.languages, [{ extension: ".swift", files: 1 }, { extension: ".ts", files: 1 }]);
  assert.doesNotMatch(JSON.stringify(report), /SOURCE_BODY_NOT_SENT|IGNORED_SOURCE_NOT_READ|DO_NOT_RUN|sourceSentinel/);
  assert.deepEqual(runner.calls.map((call) => call.args[0]), ["--version", "build", "status", "visualize"]);
  await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
});

test("CodeGraph execution drops credentials and Python injection variables and uses a runner outside the snapshot", async (t) => {
  const root = await fixture(t, { "src/app.swift": "struct App {}" });
  const outside = await fixture(t);
  const pathAlias = join(outside, "repository-bin");
  await symlink(root, pathAlias, "dir");
  const values = { GH_TOKEN: "SYNTHETIC_GH_SECRET", GITHUB_TOKEN: "SYNTHETIC_GITHUB_SECRET", COPILOT_GITHUB_TOKEN: "SYNTHETIC_COPILOT_SECRET", PYTHONPATH: root, PYTHONHOME: root, NODE_OPTIONS: "SYNTHETIC_NODE_OPTIONS", CRG_HOME: root, CRG_DATA_DIR: root };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const previousPath = process.env.PATH;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    previousPath === undefined ? delete process.env.PATH : process.env.PATH = previousPath;
  });
  Object.assign(process.env, values);
  process.env.PATH = [".", "relative-bin", root, join(root, "bin"), pathAlias, previousPath ?? ""].join(delimiter);
  const runner = transport({ onCall: async (args, options) => {
    for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "COPILOT_GITHUB_TOKEN", "PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS"]) assert.equal(options.env[key], undefined, key);
    assert.equal(options.env.PYTHONNOUSERSITE, "1");
    assert.equal(options.env.PYTHONSAFEPATH, "1");
    assert.notEqual(options.env.CRG_HOME, root);
    assert.notEqual(options.env.CRG_DATA_DIR, root);
    const toolPath = options.env.PATH.split(delimiter);
    for (const removed of [".", "relative-bin", root, join(root, "bin"), pathAlias]) assert.ok(!toolPath.includes(removed));
    assert.notEqual(options.cwd, root);
    if (args.includes("--repo")) {
      const snapshot = args[args.indexOf("--repo") + 1];
      assert.ok(relative(snapshot, options.cwd).startsWith(".."), "Python must not start in the source snapshot.");
      assert.deepEqual(await readdir(options.cwd), []);
    }
  } });
  await collectCodeGraph(root, ["src/app.swift"], runner.options);
});

test("CodeGraph refuses symlink escapes, unsafe paths, binary sources and oversized files while disclosing omissions", async (t) => {
  const root = await fixture(t, { "src/app.swift": "struct App {}", "src/binary.swift": "before\0after", "src/large.swift": "x".repeat(1_000_001) });
  const outside = await fixture(t, { "secret.swift": "OUTSIDE_SOURCE_NOT_READ" });
  await symlink(join(outside, "secret.swift"), join(root, "escape.swift"));
  await symlink(outside, join(root, "external"), "dir");
  const paths = ["src/app.swift", "src/binary.swift", "src/large.swift", "escape.swift", "external/secret.swift", "missing.swift", `${"a".repeat(241)}.swift`, "invalid\nname.swift", "src\\backslash.swift", join(outside, "secret.swift")];
  const runner = transport({ onCall: async (args) => {
    if (args[0] === "build") assert.deepEqual(await snapshotFiles(args[args.indexOf("--repo") + 1]), ["src/app.swift"]);
  } });
  const report = await collectCodeGraph(root, paths, runner.options);
  assert.equal(report.coverage.copied, 1);
  assert.equal(report.coverage.omitted, paths.length - 1);
  assert.equal(report.coverage.partial, true);
  assert.match(report.warnings.join("\n"), /candidate files omitted by path, safety or size limits/);
  assert.doesNotMatch(JSON.stringify(report), /OUTSIDE_SOURCE_NOT_READ|secret\.swift|escape\.swift/);
});

test("CodeGraph rejects relative, absent, in-repository and in-repository symlink executables before running anything", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}", "tool": "#!/bin/sh\nexit 0\n" });
  await chmod(join(root, "tool"), 0o755);
  await symlink(process.execPath, join(root, "tool-link"));
  const forbidden = () => { throw new Error("Executable should never run."); };
  for (const executable of ["code-review-graph", join(root, "missing"), join(root, "tool"), join(root, "tool-link")]) {
    await assert.rejects(collectCodeGraph(root, ["app.swift"], { executable, run: forbidden }), /absolute path|unavailable or inside the repository/);
  }
});

test("CodeGraph rejects unsupported versions without building and removes every temporary snapshot", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}" });
  for (const version of ["code-review-graph 2.3.8", "code-review-graph 2.2.99", "code-review-graph 3.0.0", "different-tool 2.3.9", "code-review-graph 2.3.9\nUNTRUSTED_OUTPUT"]) {
    const runner = transport({ version });
    await assert.rejects(collectCodeGraph(root, ["app.swift"], runner.options), /requires code-review-graph 2\.3\.9/);
    assert.deepEqual(runner.calls.map((call) => call.args[0]), ["--version"]);
    await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
  }
});

test("CodeGraph never silently falls back after collection failures and cleans the snapshot", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}" });
  for (const command of ["build", "status", "visualize"]) {
    const runner = transport({ onCall: async (args) => { if (args[0] === command) throw new Error("Injected tool failure"); } });
    await assert.rejects(collectCodeGraph(root, ["app.swift"], runner.options));
    assert.equal(runner.calls.at(-1).args[0], command);
    await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
  }
});

test("CodeGraph rejects malformed exports and unknown status without leaking raw payloads", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}" });
  for (const options of [
    { exported: "SYNTHETIC_PRIVATE_SOURCE_IS_NOT_JSON" },
    { exported: { nodes: [], edges: "unsupported" } },
    { status: "SYNTHETIC_PRIVATE_SOURCE_IS_NOT_JSON" },
    { status: {} },
  ]) {
    const runner = transport(options);
    await assert.rejects(collectCodeGraph(root, ["app.swift"], runner.options), (error) => {
      assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_SOURCE/);
      return true;
    });
    await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
  }
});

test("CodeGraph streams exports larger than 16 MB into the same bounded summary and cleans up", async (t) => {
  const paths = ["ios/App.swift", "tests/AppTests.swift"];
  const root = await fixture(t, { [paths[0]]: "struct App {}", [paths[1]]: "struct AppTests {}" });
  let graph, snapshotRoot;
  const runner = transport({ writeExport: async (path, snapshot) => {
    snapshotRoot = snapshot;
    graph = fileGraph(snapshot, paths);
    graph.edges.push({ kind: "TESTED_BY", source: graph.nodes[0].qualified_name, target: graph.nodes[1].qualified_name });
    await writePaddedExport(path, `{"nodes":[${JSON.stringify(graph.nodes[0])},`, `${JSON.stringify(graph.nodes[1])}],"edges":${JSON.stringify(graph.edges)}}`);
    assert.ok((await stat(path)).size > 16_000_000);
  } });
  const report = await collectCodeGraph(root, paths, runner.options);
  assert.deepEqual(report.coverage, { candidates: 2, copied: 2, indexed: 2, omitted: 0, unindexed: 0, partial: false });
  assert.deepEqual(report.dependencies, [{ from: paths[0], to: paths[1], kind: "TESTED_BY", count: 1 }]);
  assert.deepEqual(report, summarizeCodeGraph(graph, snapshotRoot, paths, {
    version: report.version, collectedAt: report.collectedAt, snapshotHash: report.snapshotHash, candidates: 2, partial: false,
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 24_000);
  await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
});

test("CodeGraph rejects malformed large exports without exposing raw content and cleans up", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}" });
  const runner = transport({ writeExport: async (path) => {
    await writePaddedExport(path, '{"nodes":[', 'SYNTHETIC_PRIVATE_SOURCE_IS_NOT_JSON],"edges":[]}');
    assert.ok((await stat(path)).size > 16_000_000);
  } });
  await assert.rejects(collectCodeGraph(root, ["app.swift"], runner.options), (error) => {
    assert.match(error.message, /Invalid CodeGraph export JSON/);
    assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_SOURCE/);
    return true;
  });
  await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
});

test("CodeGraph reports actual export size and limit separately from non-regular exports", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}" });
  const oversized = transport({ writeExport: async (path) => {
    const handle = await open(path, "wx");
    try { await handle.truncate(256_000_001); }
    finally { await handle.close(); }
  } });
  await assert.rejects(collectCodeGraph(root, ["app.swift"], oversized.options), (error) => {
    assert.match(error.message, /256000001/);
    assert.match(error.message, /256000000/);
    assert.doesNotMatch(error.message, /regular file/);
    return true;
  });
  await assert.rejects(access(dirname(oversized.calls[0].cwd)), { code: "ENOENT" });

  const directory = transport({ writeExport: (path) => mkdir(path) });
  await assert.rejects(collectCodeGraph(root, ["app.swift"], directory.options), /regular file/);
  await assert.rejects(access(dirname(directory.calls[0].cwd)), { code: "ENOENT" });
});

test("CodeGraph rejects an empty eligible snapshot before building and cleans up", async (t) => {
  const root = await fixture(t, { "README.md": "No supported source yet." });
  const runner = transport();
  await assert.rejects(collectCodeGraph(root, ["README.md"], runner.options), /No eligible source files/);
  assert.deepEqual(runner.calls.map((call) => call.args[0]), ["--version"]);
  await assert.rejects(access(dirname(runner.calls[0].cwd)), { code: "ENOENT" });
});

test("CodeGraph preserves incomplete-build evidence from status or parser errors", async (t) => {
  const root = await fixture(t, { "app.swift": "struct App {}" });
  for (const options of [{ status: { build_incomplete: true } }, { buildOutput: "Files indexed: 1\nErrors: 2\nPRIVATE_DIAGNOSTICS_NOT_SENT" }]) {
    const runner = transport(options);
    const report = await collectCodeGraph(root, ["app.swift"], runner.options);
    assert.equal(report.coverage.partial, true);
    assert.match(report.warnings.join("\n"), /incomplete build/);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DIAGNOSTICS_NOT_SENT/);
  }
});

test("CodeGraph summary contains allowlisted numeric structure, never symbols, signatures, comments or outside paths", () => {
  const snapshot = "/safe/snapshot";
  const paths = ["src/app.swift", "tests/AppTests.swift"];
  const graph = fileGraph(snapshot, paths);
  graph.nodes.push(
    { kind: "Function", qualified_name: "PRIVATE_FUNCTION_SENTINEL", file_path: join(snapshot, paths[0]), name: "PRIVATE_NAME", signature: "PRIVATE_SIGNATURE", docstring: "PRIVATE_DOCSTRING", parameters: ["PRIVATE_PARAMETER"], line_start: 10, line_end: 29 },
    { kind: "Function", qualified_name: "PRIVATE_TEST_SENTINEL", file_path: paths[1], line_start: 1, line_end: 4 },
    { kind: "File", qualified_name: "outside", file_path: "../../PRIVATE_OUTSIDE.swift" },
    { kind: "File", qualified_name: "unknown", file_path: "src/PRIVATE_UNLISTED.swift" },
  );
  graph.edges.push(
    { kind: "CALLS", source: "PRIVATE_TEST_SENTINEL", target: "PRIVATE_FUNCTION_SENTINEL" },
    { kind: "TESTED_BY", source: "PRIVATE_FUNCTION_SENTINEL", target: "PRIVATE_TEST_SENTINEL" },
    { kind: "CALLS", source: "PRIVATE_FUNCTION_SENTINEL", target: "outside" },
    { kind: "CALLS", source: "PRIVATE_TEST_SENTINEL", target: "PRIVATE_FUNCTION_SENTINEL", target_resolution: "unresolved" },
    { kind: "PRIVATE_RELATION", source: "PRIVATE_TEST_SENTINEL", target: "PRIVATE_FUNCTION_SENTINEL" },
  );
  const report = summarizeCodeGraph(graph, snapshot, paths, metadata());
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|safe\/snapshot/);
  assert.deepEqual(report.files.find((file) => file.path === paths[0]), { path: paths[0], symbols: 1, maxSymbolLines: 20, incoming: 1, outgoing: 1, testLinks: 1 });
  assert.deepEqual(report.relationships.filter((entry) => entry.count), [{ kind: "CALLS", count: 1 }, { kind: "TESTED_BY", count: 1 }]);
  assert.equal(report.dependencies.length, 2);
  assert.match(report.warnings.join("\n"), /4 invalid, ambiguous or out-of-snapshot graph records were excluded/);
});

test("CodeGraph summary rejects ambiguous qualified names and invalid symbol spans", () => {
  const snapshot = "/safe/snapshot", paths = ["a.swift", "b.swift"];
  const graph = fileGraph(snapshot, paths);
  graph.nodes.push(
    { kind: "Function", qualified_name: "duplicate", file_path: "a.swift", line_start: -1, line_end: 20 },
    { kind: "Function", qualified_name: "duplicate", file_path: "b.swift", line_start: 1, line_end: 999999999 },
    { kind: "Function", qualified_name: "other", file_path: "b.swift", line_start: 20, line_end: 10 },
  );
  graph.edges.push({ kind: "CALLS", source: "duplicate", target: "other" });
  const report = summarizeCodeGraph(graph, snapshot, paths, metadata());
  assert.ok(report.files.every((file) => file.maxSymbolLines === 0));
  assert.ok(report.relationships.every((entry) => entry.count === 0));
  assert.match(report.warnings.join("\n"), /ambiguous/);
});

test("CodeGraph summary caps distinct node identities without rejecting repeated identities", () => {
  const snapshot = "/safe/snapshot", paths = ["app.swift"];
  const graph = fileGraph(snapshot, paths);
  for (let index = 1; index < 100_000; index++) graph.nodes.push({ kind: "Function", qualified_name: `symbol${index}`, file_path: paths[0] });
  const report = summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: 1 }));
  assert.equal(report.files[0].symbols, 99_999);
  assert.equal(report.coverage.partial, false);

  graph.nodes.push(graph.nodes.at(-1));
  const duplicate = summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: 1 }));
  assert.equal(duplicate.files[0].symbols, 99_999);
  assert.equal(duplicate.coverage.partial, true);
  graph.nodes.push({ kind: "Function", qualified_name: "SYNTHETIC_PRIVATE_NODE_NAME", file_path: paths[0] });
  assert.throws(() => summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: 1 })), (error) => {
    assert.match(error.message, /node budget exceeded.*100000/);
    assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_NODE_NAME/);
    return true;
  });
});

test("CodeGraph summary caps unique file-pair relationships while permitting repeated edges", () => {
  const snapshot = "/safe/snapshot";
  const paths = Array.from({ length: 225 }, (_, index) => `src/File${index}.swift`);
  const graph = fileGraph(snapshot, paths);
  for (let from = 0; from < paths.length && graph.edges.length < 50_001; from++) {
    for (let to = 0; to < paths.length && graph.edges.length < 50_001; to++) {
      if (from !== to) graph.edges.push({ kind: "CALLS", source: graph.nodes[from].qualified_name, target: graph.nodes[to].qualified_name });
    }
  }
  const extra = graph.edges.pop();
  const report = summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: paths.length }));
  assert.equal(report.dependenciesOmitted, 49_980);
  assert.equal(report.relationships.find((relation) => relation.kind === "CALLS").count, 50_000);

  graph.edges.push(graph.edges[0]);
  const repeated = summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: paths.length }));
  assert.equal(repeated.dependenciesOmitted, 49_980);
  assert.equal(repeated.dependencies[0].count, 2);
  assert.equal(repeated.relationships.find((relation) => relation.kind === "CALLS").count, 50_001);
  graph.edges.push(extra);
  assert.throws(() => summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: paths.length })), /dependency budget exceeded.*50000/);
});

test("CodeGraph summary bounds ranked details and discloses heuristic, partial and unindexed coverage", () => {
  const snapshot = "/safe/snapshot";
  const paths = [...Array(25)].map((_, index) => `src/File${String(index).padStart(2, "0")}.swift`);
  const graph = fileGraph(snapshot, paths);
  for (let index = 1; index < paths.length; index++) graph.edges.push({ kind: "IMPORTS_FROM", source: join(snapshot, paths[0]), target: join(snapshot, paths[index]) });
  const report = summarizeCodeGraph(graph, snapshot, [...paths, "src/Unindexed.swift"], metadata({ candidates: 30, partial: true }));
  assert.equal(report.files.length, 20);
  assert.equal(report.filesOmitted, 5);
  assert.equal(report.dependencies.length, 20);
  assert.equal(report.dependenciesOmitted, 4);
  assert.deepEqual(report.coverage, { candidates: 30, copied: 26, indexed: 25, omitted: 4, unindexed: 1, partial: true });
  const warnings = report.warnings.join("\n");
  assert.match(warnings, /incomplete and heuristic/);
  assert.match(warnings, /Missing edges\/tests do not establish simplicity, safety or test coverage/);
  assert.match(warnings, /do not measure reasoning difficulty or model capability/);
  assert.match(warnings, /incomplete build/);
  assert.match(warnings, /ranked samples/);
  assert.match(warnings, /Metal shaders and Xcode build settings/);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 24_000);
});

test("CodeGraph summary fails closed when even bounded detail exceeds its byte budget", () => {
  const snapshot = "/safe/snapshot", paths = Array.from({ length: 20 }, (_, index) => `src/${"界".repeat(70)}/${"界".repeat(70)}/${String(index).padStart(2, "0")}${"界".repeat(70)}.swift`);
  const graph = fileGraph(snapshot, paths);
  for (let index = 0; index < paths.length; index++) graph.edges.push({ kind: "CALLS", source: join(snapshot, paths[index]), target: join(snapshot, paths[(index + 1) % paths.length]) });
  assert.throws(() => summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: paths.length })), /summary exceeds the assessment budget/);
});

test("CodeGraph summary retains native area representatives when backend connectivity dominates the ranking", () => {
  const snapshot = "/safe/snapshot";
  const backend = Array.from({ length: 25 }, (_, index) => `src/Service${index}.ts`);
  const native = "ios/Rendering.swift";
  const paths = [...backend, native], graph = fileGraph(snapshot, paths);
  graph.nodes.push({ kind: "Class", qualified_name: "private-renderer-name", file_path: native, line_start: 1, line_end: 3000 });
  for (const from of backend) for (const to of backend) if (from !== to) graph.edges.push({ kind: "IMPORTS_FROM", source: join(snapshot, from), target: join(snapshot, to) });
  const report = summarizeCodeGraph(graph, snapshot, paths, metadata({ candidates: paths.length }));
  assert.equal(report.files.length, 20);
  assert.ok(report.files.some((file) => file.path === native && file.maxSymbolLines === 3000));
  assert.match(report.warnings.join("\n"), /area\/language representatives/);
});
