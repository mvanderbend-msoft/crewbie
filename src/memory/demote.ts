import { limitsFor, type Config } from "../config.js";
import { GitHubError, record, slug, string, visibleWords as words } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { memoryLimit, SHARED_HOT } from "./context.js";
import { remoteText } from "./launch.js";

/** Demotion leaves headroom so a single new entry does not trigger another move at the next launch. */
export const DEMOTION_TARGET = 0.8;
const ENTRY = /^(?:[-*+]|\d+[.)])\s/;

/** Relative links in a hot file resolve from its directory; moved into cold/ they need one more level up. */
function rebase(text: string): string {
  return text.replace(/\]\(([^)\s]+)\)/g, (link, target: string) => /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target) ? link : `](../${target})`);
}

/**
 * Moves the oldest list entries (top of the file first) out of an over-budget hot file until it fits within
 * DEMOTION_TARGET of its limit. Headings and prose stay. Returns null when the file is within budget or has no entries.
 */
export function demoteEntries(content: string, limit: number): { hot: string; moved: string[] } | null {
  if (words(content) <= limit) return null;
  const items: { entry: boolean; text: string }[] = [];
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const last = items.at(-1);
    if (ENTRY.test(line)) items.push({ entry: true, text: line });
    else if (last?.entry && /^\s+\S/.test(line)) last.text += `\n${line}`;
    else items.push({ entry: false, text: line });
  }
  const target = Math.floor(limit * DEMOTION_TARGET);
  const moved: string[] = [];
  const render = () => items.map((item) => item.text).join("\n").replace(/\n{3,}/g, "\n\n");
  while (words(render()) > target) {
    const index = items.findIndex((item) => item.entry);
    if (index < 0) break;
    moved.push(items.splice(index, 1)[0]!.text);
  }
  return moved.length ? { hot: render(), moved } : null;
}

function label(entries: string[]): string {
  const plain = entries.map((entry) => entry.replace(ENTRY, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[[\]()`*_]/g, "").split(/\s+/).filter(Boolean).slice(0, 6).join(" "));
  return plain.join("; ").split(/\s+/).slice(0, 40).join(" ");
}

/**
 * Keeps always-loaded hot memory within budget on a Crewbie work branch by moving its oldest entries to a new cold topic
 * linked from the index. It never blocks: a PR can merge over budget and the next launch demotes. Returns the paths demoted.
 */
export async function demoteBranchMemory(client: GitHubApi, config: Config, role: string, ref: string, today = new Date().toISOString().slice(0, 10)): Promise<string[]> {
  // Only Crewbie's own feature branches: never the default branch or an agent's PR branch.
  if (!/^crewbie\/[a-z0-9][a-z0-9-]*$/.test(ref)) return [];
  const prefix = `/repos/${config.repository}`;
  try {
    const tree: { path: string; mode: "100644"; type: "blob"; content: string }[] = [];
    const demoted: string[] = [];
    for (const path of [SHARED_HOT, `.crewbie/team/${slug(role, "role")}/hot.md`]) {
      const content = await remoteText(client, config.repository, path, ref);
      const limit = memoryLimit(config, path);
      if (typeof content !== "string" || content === "large" || limit === null) continue;
      const result = demoteEntries(content, limit);
      if (!result) continue;
      const dir = path.slice(0, -"/hot.md".length);
      const chunks: string[][] = [];
      for (const entry of result.moved.map(rebase)) {
        const current = chunks.at(-1);
        if (current && words([...current, entry].join("\n")) <= limitsFor(config).topic - 20) current.push(entry);
        else chunks.push([entry]);
      }
      const links: string[] = [];
      let n = 0;
      for (const chunk of chunks) {
        let name: string;
        do name = `cold/earlier-${today}${++n === 1 ? "" : `-${n}`}.md`;
        while (await remoteText(client, config.repository, `${dir}/${name}`, ref) !== null);
        tree.push({ path: `${dir}/${name}`, mode: "100644", type: "blob", content: `# Earlier entries from hot.md\n\nMoved by Crewbie on ${today} to keep hot memory within its word budget.\n\n${chunk.join("\n")}\n` });
        links.push(`- [Earlier entries: ${label(chunk)}](${name})`);
      }
      const index = await remoteText(client, config.repository, `${dir}/index.md`, ref);
      const base = typeof index === "string" && index !== "large" ? index.trimEnd() : "# Memory index";
      tree.push({ path: `${dir}/index.md`, mode: "100644", type: "blob", content: `${base}\n${links.join("\n")}\n` });
      tree.push({ path, mode: "100644", type: "blob", content: result.hot.trimEnd() + "\n" });
      demoted.push(path);
    }
    if (!tree.length) return [];
    const head = string(record(record(await client.request("GET", `${prefix}/git/ref/heads/${ref}`), "branch ref").object, "branch object").sha, "branch SHA");
    const parent = record(await client.request("GET", `${prefix}/git/commits/${head}`), "branch commit");
    const created = record(await client.request("POST", `${prefix}/git/trees`, { base_tree: string(record(parent.tree, "tree").sha, "tree SHA"), tree }), "demotion tree");
    const commit = record(await client.request("POST", `${prefix}/git/commits`, {
      message: `Move oldest hot memory to cold topics\n\n${demoted.join(", ")} exceeded the word budget; Crewbie moved the oldest entries and linked them from the index.`,
      tree: string(created.sha, "tree SHA"), parents: [head],
    }), "demotion commit");
    await client.request("PATCH", `${prefix}/git/refs/heads/${ref}`, { sha: string(commit.sha, "commit SHA"), force: false });
    return demoted;
  } catch (error) {
    // A moved branch or transient failure only delays demotion to the next launch; the launch continues.
    console.warn(`Crewbie: hot memory on ${ref} was not demoted: ${error instanceof GitHubError ? `HTTP ${error.status}` : error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
