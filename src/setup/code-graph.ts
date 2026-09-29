import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { record, safePath } from "../core.js";
import { redact } from "./inventory.js";
import { readCodeGraphRecords } from "./code-graph-export.js";

const execute = promisify(execFile);
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|rb|php|swift|kt|kts|c|h|cc|cpp|hpp|m|mm|scala|sc|dart|vue|svelte|sol|ex|exs|zig|lua|luau|r|pl|pm)$/i;
const EXCLUDED = /(^|\/)(?:\.[^/]+|node_modules|vendor|dist|build|coverage|target|Pods|Carthage|DerivedData)(\/|$)/;
const LIMITS = { files: 2_000, fileBytes: 1_000_000, sourceBytes: 20_000_000, nodes: 100_000, dependencies: 50_000, reportBytes: 24_000, paths: 20, timeout: 120_000 };
const RELATIONS = ["CALLS", "IMPORTS_FROM", "INHERITS", "IMPLEMENTS", "TESTED_BY", "DEPENDS_ON"] as const;
type Relation = typeof RELATIONS[number];

export interface CodeGraphEvidence {
  provider: "code-review-graph";
  version: string;
  collectedAt: string;
  snapshotHash: string;
  scope: string;
  coverage: { candidates: number; copied: number; indexed: number; omitted: number; unindexed: number; partial: boolean };
  languages: { extension: string; files: number }[];
  files: { path: string; symbols: number; maxSymbolLines: number; incoming: number; outgoing: number; testLinks: number }[];
  filesOmitted: number;
  relationships: { kind: Relation; count: number }[];
  dependencies: { from: string; to: string; kind: Relation; count: number }[];
  dependenciesOmitted: number;
  warnings: string[];
}

export interface CodeGraphRunOptions { cwd: string; env: NodeJS.ProcessEnv }
export interface CodeGraphOptions {
  executable?: string;
  /** Injectable transport for offline tests; not a CLI option. */
  run?: (executable: string, args: string[], options: CodeGraphRunOptions) => Promise<string>;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function trustedPath(root: string): Promise<string> {
  const paths: string[] = [];
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(path) || within(root, resolve(path))) continue;
    try {
      const actual = await realpath(path);
      if (!within(root, actual) && (await lstat(actual)).isDirectory()) paths.push(actual);
    } catch { /* Ignore missing or inaccessible PATH entries. */ }
  }
  return [...new Set(paths)].join(delimiter);
}

function parseGraphJson(text: string, name: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error(`Invalid CodeGraph ${name} JSON. No assessment was sent; raw tool output was withheld.`); }
}

/** Do not resolve a tool from the checkout, relative PATH entries, or a shell. */
async function executablePath(root: string, explicit?: string): Promise<string> {
  if (explicit !== undefined && !isAbsolute(explicit)) throw new Error("--code-graph-bin must be an absolute path to a trusted executable outside the repository.");
  const candidates = explicit !== undefined ? [explicit] : (process.env.PATH ?? "").split(delimiter)
    .filter((path) => isAbsolute(path) && !within(root, resolve(path)))
    .flatMap((path) => [join(path, "code-review-graph"), ...(process.platform === "win32" ? [join(path, "code-review-graph.exe")] : [])]);
  for (const candidate of candidates) {
    try {
      const actual = await realpath(candidate);
      const parent = await realpath(dirname(candidate));
      if (within(root, candidate) || within(root, parent) || within(root, actual) || !(await lstat(actual)).isFile()) continue;
      await access(actual, constants.X_OK);
      return actual;
    } catch { /* Try the next explicitly installed executable. */ }
  }
  throw new Error("CodeGraph executable unavailable or inside the repository. Install a trusted code-review-graph 2.3.9+ (2.x) separately, use --code-graph-bin /absolute/path, or rerun without --code-graph. Crewbie installs nothing automatically.");
}

async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile()) throw new Error("CodeGraph source input is not a regular file.");
  if (before.size > limit) throw new Error(`CodeGraph source input is ${before.size} bytes; limit is ${limit} bytes.`);
  // Check before opening (FIFOs can block on open); recheck the descriptor for replacement races.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("CodeGraph source input is not a regular file.");
    if (stat.size > limit) throw new Error(`CodeGraph source input is ${stat.size} bytes; limit is ${limit} bytes.`);
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const next = await handle.read(bytes, length, bytes.length - length, null);
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    if (length !== stat.size) throw new Error("File changed during the CodeGraph snapshot.");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

async function runGraph(executable: string, args: string[], options: CodeGraphRunOptions): Promise<string> {
  try {
    const result = await execute(executable, args, {
      ...options, encoding: "utf8", timeout: LIMITS.timeout, maxBuffer: 1_000_000, windowsHide: true, shell: false,
    });
    return result.stdout;
  } catch {
    // Tool diagnostics can contain source, absolute paths or credentials; never relay them to the model or terminal.
    throw new Error(`CodeGraph ${args[0]} failed or exceeded its time/output limit. No assessment was sent. Check the trusted installation, or rerun without --code-graph.`);
  }
}

interface GraphMetadata {
  version: string; collectedAt: string; snapshotHash: string; candidates: number; partial: boolean;
}

/** Accumulate only symbol-to-file lookups and file-level counts; discard raw records immediately. */
function graphSummary(snapshot: string, paths: string[], metadata: GraphMetadata) {
  const allowed = new Set(paths);
  const nodes = new Map<string, string>();
  const files = new Map<string, CodeGraphEvidence["files"][number]>();
  const indexed = new Set<string>();
  const counts = new Map<Relation, number>();
  const dependencies = new Map<string, CodeGraphEvidence["dependencies"][number]>();
  let rejected = 0;
  function addNode(raw: unknown): void {
    const node = record(raw, "CodeGraph node");
    if (typeof node.file_path !== "string" || typeof node.qualified_name !== "string"
      || Buffer.byteLength(node.qualified_name) > 1024 || node.file_path.length > 4096) { rejected++; return; }
    const path = relative(snapshot, resolve(snapshot, node.file_path)).split(sep).join("/");
    if (!allowed.has(path)) { rejected++; return; }
    // Truncated/duplicate qualified names cannot safely establish graph edges.
    if (nodes.has(node.qualified_name)) { nodes.set(node.qualified_name, ""); rejected++; return; }
    if (nodes.size >= LIMITS.nodes) throw new Error(`CodeGraph node budget exceeded: more than ${LIMITS.nodes} distinct identities. No assessment was sent.`);
    nodes.set(node.qualified_name, path);
    if (node.kind === "File") indexed.add(path);
    const file = files.get(path) ?? { path, symbols: 0, maxSymbolLines: 0, incoming: 0, outgoing: 0, testLinks: 0 };
    if (["Function", "Class", "Type"].includes(String(node.kind))) {
      file.symbols++;
      if (Number.isSafeInteger(node.line_start) && Number.isSafeInteger(node.line_end)
        && Number(node.line_start) > 0 && Number(node.line_end) >= Number(node.line_start) && Number(node.line_end) <= LIMITS.fileBytes) {
        file.maxSymbolLines = Math.max(file.maxSymbolLines, Number(node.line_end) - Number(node.line_start) + 1);
      }
    }
    files.set(path, file);
  }
  function addEdge(raw: unknown): void {
    const edge = record(raw, "CodeGraph edge");
    if (!RELATIONS.includes(edge.kind as Relation)) return;
    const from = typeof edge.source === "string" ? nodes.get(edge.source) : undefined;
    const to = typeof edge.target === "string" ? nodes.get(edge.target) : undefined;
    if (!from || !to || edge.target_resolution === "unresolved") { rejected++; return; }
    const kind = edge.kind as Relation;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (kind === "TESTED_BY") { files.get(from)!.testLinks++; files.get(to)!.testLinks++; }
    if (from === to) return;
    files.get(from)!.outgoing++;
    files.get(to)!.incoming++;
    const key = JSON.stringify([from, to, kind]);
    if (!dependencies.has(key) && dependencies.size >= LIMITS.dependencies) throw new Error(`CodeGraph dependency budget exceeded: more than ${LIMITS.dependencies} file-pair relationships. No assessment was sent.`);
    const dependency = dependencies.get(key) ?? { from, to, kind, count: 0 };
    dependency.count++;
    dependencies.set(key, dependency);
  }
  function finish(): CodeGraphEvidence {
    const languages = new Map<string, number>();
    for (const path of indexed) languages.set(extname(path).toLowerCase(), (languages.get(extname(path).toLowerCase()) ?? 0) + 1);
    const ranked = [...files.values()].sort((a, b) => b.incoming + b.outgoing - a.incoming - a.outgoing || b.maxSymbolLines - a.maxSymbolLines || a.path.localeCompare(b.path));
    const links = [...dependencies.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
    // Preserve a representative of each area/language before filling by connectivity: otherwise
    // a large native renderer can disappear behind many interconnected backend files.
    const areas = new Set<string>();
    const representatives = [...ranked].sort((a, b) => b.maxSymbolLines - a.maxSymbolLines || a.path.localeCompare(b.path)).filter((file) => {
      const area = `${file.path.includes("/") ? file.path.split("/")[0] : "."}:${extname(file.path).toLowerCase()}`;
      if (areas.has(area)) return false;
      areas.add(area); return true;
    });
    const selected = [...new Set([...representatives, ...ranked])].slice(0, LIMITS.paths);
    const omitted = metadata.candidates - paths.length;
    const unindexed = paths.length - indexed.size;
    const result: CodeGraphEvidence = {
      provider: "code-review-graph", version: metadata.version, collectedAt: metadata.collectedAt, snapshotHash: metadata.snapshotHash,
      scope: "Fresh temporary snapshot of selected non-ignored source files. Paths, extension counts, symbol counts/spans and resolved structural relationships only; no source bodies, symbol names, comments or signatures. No project scripts, repository graph configuration, MCP servers or embeddings run. Snapshot evidence, not a live index or a model benchmark.",
      coverage: { candidates: metadata.candidates, copied: paths.length, indexed: indexed.size, omitted, unindexed, partial: metadata.partial || omitted > 0 || unindexed > 0 || rejected > 0 },
      languages: [...languages].sort(([a], [b]) => a.localeCompare(b)).map(([extension, files]) => ({ extension, files })),
      files: selected, filesOmitted: Math.max(0, ranked.length - selected.length),
      relationships: RELATIONS.map((kind) => ({ kind, count: counts.get(kind) ?? 0 })),
      dependencies: links.slice(0, LIMITS.paths), dependenciesOmitted: Math.max(0, links.length - LIMITS.paths),
      warnings: [
        "Static relationships are incomplete and heuristic. Missing edges/tests do not establish simplicity, safety or test coverage. File size and connectivity do not measure reasoning difficulty or model capability.",
        "Only the supported source-extension allowlist is copied; ignored, hidden, generated, dependency and unsupported files (including Metal shaders and Xcode build settings) are excluded. Runtime behavior, build configuration and future task requirements are unknown.",
        ...(omitted ? [`${omitted} candidate files omitted by path, safety or size limits.`] : []),
        ...(unindexed ? [`${unindexed} copied files have no indexed File node; language/parser coverage is incomplete.`] : []),
        ...(metadata.partial ? ["The indexer reported an incomplete build; do not infer absence from missing results."] : []),
        ...(rejected ? [`${rejected} invalid, ambiguous or out-of-snapshot graph records were excluded.`] : []),
        ...(ranked.length > LIMITS.paths || links.length > LIMITS.paths ? ["File details are area/language representatives plus hotspots; dependencies are ranked samples, not the entire graph."] : []),
      ],
    };
    if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.reportBytes) throw new Error("CodeGraph summary exceeds the assessment budget; no assessment was sent.");
    return result;
  }
  return { addNode, addEdge, finish };
}

/** Only validated file paths and numeric structure leave the collector. No names, docstrings, source or signatures. */
export function summarizeCodeGraph(value: unknown, snapshot: string, paths: string[], metadata: GraphMetadata): CodeGraphEvidence {
  const graph = record(value, "CodeGraph export");
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("Unsupported CodeGraph export: expected nodes and edges.");
  const summary = graphSummary(snapshot, paths, metadata);
  for (const node of graph.nodes) summary.addNode(node);
  for (const edge of graph.edges) summary.addEdge(edge);
  return summary.finish();
}

async function summarizeExport(path: string, snapshot: string, paths: string[], metadata: GraphMetadata): Promise<CodeGraphEvidence> {
  const summary = graphSummary(snapshot, paths, metadata);
  async function fingerprint(): Promise<string> {
    try {
      const stat = await lstat(path, { bigint: true });
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
    } catch { throw new Error("CodeGraph export became unavailable while reading. No assessment was sent."); }
  }
  const before = await fingerprint();
  async function unchanged(): Promise<void> {
    if (await fingerprint() !== before) throw new Error("CodeGraph export changed while reading. No assessment was sent.");
  }
  // Two passes also support exports whose edges appear before nodes. Neither pass retains the export.
  for await (const node of readCodeGraphRecords(path, "nodes")) summary.addNode(node);
  await unchanged();
  for await (const edge of readCodeGraphRecords(path, "edges")) summary.addEdge(edge);
  await unchanged();
  return summary.finish();
}

export async function collectCodeGraph(root: string, files: string[], options: CodeGraphOptions = {}): Promise<CodeGraphEvidence> {
  const base = await realpath(root);
  const executable = await executablePath(base, options.executable);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "crewbie-code-graph-")));
  try {
    const snapshot = join(temporary, "source"), data = join(temporary, "graph"), cwd = join(temporary, "runner");
    await Promise.all([mkdir(snapshot), mkdir(data), mkdir(cwd)]);
    // A trusted empty marker satisfies the indexer's project-root check; never copy repository graph config.
    await mkdir(join(snapshot, ".code-review-graph"));
    // No credentials, Python/Git injection variables, inherited graph settings or project-local executables.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) if (process.env[key]) env[key] = process.env[key];
    env.PATH = await trustedPath(base);
    env.PYTHONNOUSERSITE = "1"; env.PYTHONSAFEPATH = "1";
    env.CRG_HOME = join(temporary, "state"); env.CRG_DATA_DIR = data;
    env.CRG_PARSE_WORKERS = "1"; env.CRG_PARSE_EXECUTOR = "thread";
    const run = options.run ?? runGraph;
    const executeGraph = (args: string[]) => run(executable, args, { cwd, env });
    const versionText = (await executeGraph(["--version"])).trim();
    const version = /^code-review-graph\s+(2\.(\d+)\.(\d+))$/.exec(versionText);
    if (!version || Number(version[2]) < 3 || (Number(version[2]) === 3 && Number(version[3]) < 9)) {
      throw new Error("CodeGraph integration requires code-review-graph 2.3.9+ (2.x). No assessment was sent.");
    }
    const candidates = [...new Set(files)].filter((path) => SOURCE.test(path) && !EXCLUDED.test(path)).sort();
    const copied: string[] = [];
    const digest = createHash("sha256");
    let remaining = LIMITS.sourceBytes;
    for (const path of candidates) {
      if (copied.length >= LIMITS.files || path.length > 240 || path.includes("\\") || /[\x00-\x1f\x7f]/.test(path) || redact(path) !== path) continue;
      let content: Buffer;
      try { content = await boundedRead(await safePath(base, path), Math.min(LIMITS.fileBytes, remaining)); }
      catch { continue; }
      if (content.includes(0)) continue;
      const target = await safePath(snapshot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx" });
      remaining -= content.length;
      copied.push(path);
      digest.update(JSON.stringify([path, content.length])); digest.update(content);
    }
    const collectedAt = new Date().toISOString();
    if (!copied.length) throw new Error("No eligible source files for CodeGraph. Nothing was sent; rerun without --code-graph for names-only assessment.");
    const flags = ["--repo", snapshot, "--data-dir", data];
    const buildOutput = await executeGraph(["build", ...flags, "--skip-postprocess"]);
    const status = record(parseGraphJson(await executeGraph(["status", ...flags, "--json"]), "status"), "CodeGraph status");
    if (typeof status.build_incomplete !== "boolean") throw new Error("Unsupported CodeGraph status: build completeness is unknown. No assessment was sent.");
    await executeGraph(["visualize", ...flags, "--format", "json"]);
    return await summarizeExport(await safePath(temporary, "graph/graph.json"), snapshot, copied, {
      version: version[1]!, collectedAt, snapshotHash: digest.digest("hex"), candidates: candidates.length,
      partial: status.build_incomplete || /^\s*Errors:\s*[1-9]\d*/m.test(buildOutput),
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
