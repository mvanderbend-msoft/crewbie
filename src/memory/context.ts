import { bounded, optionalText, safePath, slug, textHash } from "../core.js";
import { limitsFor, type Config } from "../config.js";

export interface ContextFile { path: string; content: string; sha256: string }
export function relevantTopics(index: string, query: string): string[] {
  const stop = new Set(["crewbie", "shared", "memory", "index", "archive", "cold", "with", "from", "that", "this", "have", "were", "been"]);
  const tokens = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !stop.has(word)));
  const wanted = tokens(query);
  const candidates = new Map<string, number>();
  for (const match of index.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const path = (match[2] ?? "").replace(/^(?:\.crewbie\/decisions\/|\.\.\/\.\.\/decisions\/|decisions\/)/, "shared/");
    if (!/^(shared\/)?(cold|archive)\/[a-z0-9][a-z0-9-]*\.md$/.test(path)) continue;
    const score = [...tokens(`${match[1]} ${path}`)].filter((word) => wanted.has(word)).length;
    if (score) candidates.set(path, Math.max(score, candidates.get(path) ?? 0));
  }
  return [...candidates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([path]) => path);
}
export async function memoryContext(root: string, config: Config, role: string, topics: string[] = []): Promise<ContextFile[]> {
  slug(role, "role");
  const limits = limitsFor(config);
  if (!["coordinator", "improver", ...config.roles.map((item) => item.id)].includes(role)) {
    throw new Error("Choose a configured role.");
  }
  const paths: [string, number | null][] = [
    ...(config.constitution ? [[config.constitution, limits.constitution] as [string, number]] : []),
    [".crewbie/decisions.md", null],
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
    if (content === null) throw new Error(`Required context is missing: ${path}`);
    if (limit !== null) bounded(content, limit, path);
    result.push({ path, content, sha256: textHash(content) });
  }
  return result;
}
