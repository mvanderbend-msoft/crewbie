import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodeGraphRecords } from "../dist/setup/code-graph-export.js";

async function exported(t, content = '{"nodes":[],"edges":[]}') {
  const root = await mkdtemp(join(tmpdir(), "crewbie-graph-export-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "graph.json");
  await writeFile(path, content);
  return path;
}

async function records(path, kind = "nodes", limits) {
  const result = [];
  for await (const value of readCodeGraphRecords(path, kind, limits)) result.push(value);
  return result;
}

test("CodeGraph export streams either record kind independently of root field order", async (t) => {
  const nodes = [{ file_path: "ios/App.swift", nested: { flags: [true, false, null], value: -1.25e12 }, name: "quoted \"🦊\"" }, {}];
  const edges = [{ source: "a", target: "b", kind: "CALLS" }];
  for (const graph of [{ nodes, edges }, { communities: [{ nodes: [1, 2], edges: [null] }], edges, metadata: "ignored", nodes }]) {
    const path = await exported(t, JSON.stringify(graph));
    assert.deepEqual(await records(path, "nodes"), nodes);
    assert.deepEqual(await records(path, "edges"), edges);
  }
});

test("CodeGraph export handles UTF-8, escapes and Unicode escapes across read boundaries", async (t) => {
  const prefix = '{"nodes":[{"text":"';
  for (const suffix of ["é🦊", '\\"quoted\\\\tail', "\\u0041\\nend"]) {
    const text = `${prefix}${"x".repeat(65_535 - Buffer.byteLength(prefix))}${suffix}"}],"edges":[]}`;
    const path = await exported(t, text);
    assert.deepEqual(await records(path), JSON.parse(text).nodes);
  }
  for (const literal of ["1.25e-12", "true", "false", "null"]) {
    const start = '{"metadata":';
    const text = `${start}${" ".repeat(65_535 - start.length)}${literal},"nodes":[{}],"edges":[]}`;
    const path = await exported(t, text);
    assert.deepEqual(await records(path), [{}]);
  }
});

test("CodeGraph export accepts valid exports larger than the former 16MB cap", async (t) => {
  const path = await exported(t, `${" ".repeat(17_000_000)}{"nodes":[{"id":"a"}],"edges":[]}`);
  assert.deepEqual(await records(path), [{ id: "a" }]);
});

test("CodeGraph export skips large metadata arrays incrementally rather than buffering their whole value", async (t) => {
  const graph = { communities: Array.from({ length: 10_000 }, () => ({ label: "x".repeat(200), values: [true, null, 1] })), edges: [], nodes: [{ id: "a" }] };
  const path = await exported(t, JSON.stringify(graph));
  assert.deepEqual(await records(path, "nodes", { maxValueBytes: 256 }), [{ id: "a" }]);
});

test("CodeGraph export enforces total size with exact numeric diagnostics", async (t) => {
  const content = '{"nodes":[],"edges":[]}';
  const path = await exported(t, content);
  assert.deepEqual(await records(path, "nodes", { maxBytes: Buffer.byteLength(content) }), []);
  await assert.rejects(records(path, "nodes", { maxBytes: Buffer.byteLength(content) - 1 }), /is 23 bytes; the input limit is 22 bytes/);
  const sparse = await exported(t);
  const handle = await open(sparse, "r+");
  try { await handle.truncate(256_000_001); } finally { await handle.close(); }
  await assert.rejects(records(sparse), /is 256000001 bytes; the input limit is 256000000 bytes/);
});

test("CodeGraph export bounds individual records in both selected and unselected arrays", async (t) => {
  const exact = { value: "x".repeat(116) };
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 128);
  for (const kind of ["nodes", "edges"]) {
    const path = await exported(t, JSON.stringify({ nodes: [exact], edges: [] }));
    assert.deepEqual(await records(path, kind, { maxValueBytes: 128 }), kind === "nodes" ? [exact] : []);
    await writeFile(path, JSON.stringify({ nodes: [{ value: `${exact.value}x` }], edges: [] }));
    await assert.rejects(records(path, kind, { maxValueBytes: 128 }), /value is 129 bytes; the buffered value limit is 128 bytes/);
  }
  const utf8 = await exported(t, JSON.stringify({ nodes: [{ value: "é".repeat(59) }], edges: [] }));
  await assert.rejects(records(utf8, "nodes", { maxValueBytes: 128 }), /buffered value limit is 128 bytes/);
});

test("CodeGraph export also bounds metadata strings and duplicate-key tracking", async (t) => {
  const largeString = await exported(t, JSON.stringify({ nodes: [], edges: [], metadata: "x".repeat(300) }));
  await assert.rejects(records(largeString, "nodes", { maxValueBytes: 256 }), /buffered value limit is 256 bytes/);
  const manyKeys = await exported(t, JSON.stringify({ nodes: [], edges: [], ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key${i}`, null])) }));
  await assert.rejects(records(manyKeys, "nodes", { maxValueBytes: 256 }), /buffered value limit is 256 bytes/);
});

test("CodeGraph export enforces nesting depth in graph records and skipped metadata", async (t) => {
  const allowed = await exported(t, '{"nodes":[{"nested":[]}],"edges":[]}');
  assert.deepEqual(await records(allowed, "nodes", { maxDepth: 4 }), [{ nested: [] }]);
  for (const content of ['{"nodes":[{"nested":[{}]}],"edges":[]}', '{"nodes":[],"edges":[],"metadata":[[[[]]]]}']) {
    const path = await exported(t, content);
    await assert.rejects(records(path, "nodes", { maxDepth: 4 }), /nesting limit of 4/);
  }
});

test("CodeGraph export strictly rejects malformed, truncated, duplicate or wrong-shaped JSON", async (t) => {
  const invalid = [
    "", "[]", "null", "{}", '{"nodes":[]}', '{"edges":[]}',
    '{"nodes":{},"edges":[]}', '{"nodes":[],"edges":null}',
    '{"nodes":[1],"edges":[]}', '{"nodes":[],"edges":[[]]}',
    '{"nodes":[null],"edges":[]}', '{"nodes":["secret"],"edges":[]}',
    '{"nodes":[],"edges":[],}', '{"nodes":[{},],"edges":[]}',
    '{"nodes":[{"a":}],"edges":[]}', '{"nodes":[{"a":1 "b":2}],"edges":[]}',
    '{"nodes":[],"edges":[]', '{"nodes":[{"a":"unfinished}',
    '{"nodes":[],"edges":[],"metadata":tru}', '{"nodes":[],"edges":[],"metadata":truefalse}',
    '{"nodes":[],"edges":[],"metadata":01}', '{"nodes":[],"edges":[],"metadata":1.}',
    '{"nodes":[],"edges":[],"metadata":1e+}', '{"nodes":[],"edges":[],"metadata":+1}',
    '{"nodes":[],"edges":[],"metadata":NaN}', '{"nodes":[],"edges":[],"metadata":"\\x01"}',
    '{"nodes":[],"edges":[],"metadata":"\\u01xz"}', '{"nodes":[],"edges":[],"metadata":"line\nbreak"}',
    '{"nodes":[],"edges":[],"nodes":[]}', '{"nodes":[],"edges":[],"\\u006eodes":[]}',
    '{"nodes":[],"edges":[],"metadata":1,"metadata":2}',
    '{"nodes":[],"edges":[]}{}', '{"nodes":[],"edges":[]} PRIVATE_RAW_SENTINEL',
    '\uFEFF{"nodes":[],"edges":[]}',
    Buffer.concat([Buffer.from('{"nodes":[],"edges":[],"metadata":"'), Buffer.from([0xff]), Buffer.from('"}')]),
    Buffer.concat([Buffer.from('{"nodes":[],"edges":[],"metadata":"'), Buffer.from([0xf0, 0x9f])]),
  ];
  for (const content of invalid) {
    const path = await exported(t, content);
    for (const kind of ["nodes", "edges"]) {
      await assert.rejects(records(path, kind), (error) => {
        assert.match(error.message, /^Invalid CodeGraph export JSON\./);
        assert.doesNotMatch(error.message, /PRIVATE_RAW_SENTINEL|secret|crewbie-graph-export-test-/);
        return true;
      });
    }
  }
});

test("CodeGraph export rejects directories, symlinks and missing files without disclosing their paths", async (t) => {
  const path = await exported(t);
  const directory = `${path}-directory`;
  const link = `${path}-link`;
  await mkdir(directory);
  await symlink(path, link);
  for (const invalid of [directory, link]) {
    await assert.rejects(records(invalid), (error) => {
      assert.match(error.message, /must be a regular file/);
      assert.ok(!error.message.includes(invalid));
      return true;
    });
  }
  await assert.rejects(records(`${path}-missing`), (error) => {
    assert.match(error.message, /Unable to read the CodeGraph export safely/);
    assert.ok(!error.message.includes(path));
    return true;
  });
});

test("CodeGraph export closes its reader when the consumer stops early", async (t) => {
  const path = await exported(t, '{"nodes":[{"id":1},{"id":2}],"edges":[]}');
  const reader = readCodeGraphRecords(path, "nodes");
  assert.deepEqual(await reader.next(), { value: { id: 1 }, done: false });
  await reader.return();
  await rename(path, `${path}-closed`);
  await writeFile(path, '{"nodes":[{"id":3}],"edges":[]}');
  assert.deepEqual(await records(path), [{ id: 3 }]);
});

test("CodeGraph export detects changes and budget growth while a reader is paused", async (t) => {
  const content = '{"nodes":[{"id":1},{"id":2}],"edges":[]}';
  for (const limited of [false, true]) {
    const path = await exported(t, content);
    const reader = readCodeGraphRecords(path, "nodes", limited ? { maxBytes: Buffer.byteLength(content) + 5 } : {});
    await reader.next();
    await appendFile(path, " ".repeat(10));
    await assert.rejects(async () => { for await (const unused of reader) void unused; }, limited ? /input limit/ : /changed while reading/);
  }
});

test("CodeGraph export test-only limits cannot raise production safety budgets", async (t) => {
  const path = await exported(t);
  for (const limits of [{ maxBytes: 256_000_001 }, { maxValueBytes: 1_000_001 }, { maxDepth: 65 }, { maxDepth: 0 }, { maxBytes: NaN }]) {
    await assert.rejects(records(path, "nodes", limits), /Invalid CodeGraph export reader limits/);
  }
});
