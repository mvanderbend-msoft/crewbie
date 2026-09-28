import { bounded, optionalText, safePath, slug, textHash } from "../core.js";
import { limitsFor, type Config } from "../config.js";

export interface ContextFile { path: string; content: string; sha256: string }
export const SHARED_HOT = ".crewbie/decisions/hot.md";
export const SHARED_INDEX = ".crewbie/decisions/index.md";
/** Pre-split shared decisions file; upgrades move its content into SHARED_HOT. */
export const LEGACY_DECISIONS = ".crewbie/decisions.md";
function scoreTopics(index: string, query: string, shared: boolean, candidates: Map<string, number>): void {
  const stop = new Set(["crewbie", "shared", "memory", "index", "archive", "cold", "with", "from", "that", "this", "have", "were", "been"]);
  const tokens = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !stop.has(word)));
  const wanted = tokens(query);
  for (const match of index.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    let path = (match[2] ?? "").replace(/^\.\//, "").replace(/^(?:\.crewbie\/decisions\/|(?:\.\.\/)+decisions\/|decisions\/)/, "shared/");
    // Links in the shared index are relative to .crewbie/decisions/.
    if (shared && /^(cold|archive)\//.test(path)) path = `shared/${path}`;
    if (!/^(shared\/)?(cold|archive)\/[a-z0-9][a-z0-9-]*\.md$/.test(path)) continue;
    const score = [...tokens(`${match[1]} ${path}`)].filter((word) => wanted.has(word)).length;
    if (score) candidates.set(path, Math.max(score, candidates.get(path) ?? 0));
  }
}
const topFive = (candidates: Map<string, number>) => [...candidates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([path]) => path);
export function relevantTopics(index: string, query: string, shared = false): string[] {
  const candidates = new Map<string, number>();
  scoreTopics(index, query, shared, candidates);
  return topFive(candidates);
}
/** Relevant cold/archive topics across the role index and the shared decisions index in loaded context. */
export function contextTopics(files: ContextFile[], query: string): string[] {
  const candidates = new Map<string, number>();
  for (const file of files) {
    if (file.path === SHARED_INDEX) scoreTopics(file.content, query, true, candidates);
    else if (/^\.crewbie\/team\/[^/]+\/index\.md$/.test(file.path)) scoreTopics(file.content, query, false, candidates);
  }
  return topFive(candidates);
}
export async function memoryContext(root: string, config: Config, role: string, topics: string[] = []): Promise<ContextFile[]> {
  slug(role, "role");
  const limits = limitsFor(config);
  if (!["coordinator", "improver", ...config.roles.map((item) => item.id)].includes(role)) {
    throw new Error("Choose a configured role.");
  }
  const paths: [string, number | null][] = [
    ...(config.constitution ? [[config.constitution, limits.constitution] as [string, number]] : []),
    [SHARED_HOT, limits.hot],
    [SHARED_INDEX, null],
    [`.crewbie/team/${role}/hot.md`, limits.hot],
    [`.crewbie/team/${role}/index.md`, null],
  ];
  const shared = await optionalText(await safePath(root, ".crewbie/instructions.md"));
  if (shared !== null) paths.unshift([".crewbie/instructions.md", limits.constitution]);
  else {
    const charter = await optionalText(await safePath(root, `.github/agents/crewbie-${role}.agent.md`));
    if (charter?.includes(".crewbie/instructions.md")) throw new Error("Required shared working rules are missing: .crewbie/instructions.md");
  }
  if (topics.length > 5) throw new Error("Retrieve at most five relevant memory topics at a time.");
  for (const topic of topics) {
    if (!/^(shared\/)?(cold|archive)\/[a-z0-9][a-z0-9-]*\.md$/.test(topic)) throw new Error("Memory topic must be [shared/]cold/name.md or [shared/]archive/name.md.");
    paths.push([topic.startsWith("shared/") ? `.crewbie/decisions/${topic.slice(7)}` : `.crewbie/team/${role}/${topic}`, limits.topic]);
  }
  const result: ContextFile[] = [];
  for (const [path, limit] of paths) {
    const content = await optionalText(await safePath(root, path));
    if (content === null) {
      if (path === SHARED_HOT && await optionalText(await safePath(root, LEGACY_DECISIONS)) !== null) throw new Error(`Shared decisions moved to ${SHARED_HOT}; run crewbie update --apply to migrate ${LEGACY_DECISIONS}.`);
      throw new Error(`Required context is missing: ${path}`);
    }
    if (limit !== null) bounded(content, limit, path);
    result.push({ path, content, sha256: textHash(content) });
  }
  return result;
}
