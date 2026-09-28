import { type Config } from "../config.js";
import { GitHubError, record, slug, textHash, words } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { memoryLimit, SHARED_HOT, SHARED_INDEX } from "./context.js";
import { demoteBranchMemory } from "./demote.js";

// GitHub documents no limit for launch instructions; stay well below issue-body size so assignment is not rejected.
export const LAUNCH_MEMORY_CHARACTERS = 20_000;

export function launchMemoryPaths(config: Config, role: string): string[] {
  slug(role, "role");
  return [
    ".crewbie/instructions.md",
    ...(config.constitution ? [config.constitution] : []),
    SHARED_HOT,
    SHARED_INDEX,
    `.crewbie/team/${role}/hot.md`,
    `.crewbie/team/${role}/index.md`,
  ];
}

export async function remoteText(client: GitHubApi, repository: string, path: string, ref: string): Promise<string | null | "large"> {
  try {
    const file = record(await client.request("GET", `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`), "memory file");
    if (file.type !== "file") return null;
    // Files over 1 MB come back without inline content.
    if (file.encoding !== "base64" || typeof file.content !== "string") return "large";
    return Buffer.from(file.content, "base64").toString("utf8");
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

export interface LaunchContext { ref: string; files: { path: string; sha256: string }[]; unread: string[]; missing: string[] }

/**
 * The role's required Crewbie memory at the launch revision, embedded in cloud-agent launch instructions.
 * Cloud agents told to read memory often skipped it; embedding makes the context deterministic, like the Actions jobs.
 * `context` records exactly what was embedded, so no agent has to spend output tokens reporting it.
 */
export async function launchMemory(client: GitHubApi, config: Config, role: string, ref: string): Promise<{ text: string; context: LaunchContext }> {
  await demoteBranchMemory(client, config, role, ref);
  const blocks: string[] = [], missing: string[] = [], unread: string[] = [], files: LaunchContext["files"] = [];
  let budget = LAUNCH_MEMORY_CHARACTERS;
  for (const path of launchMemoryPaths(config, role)) {
    const content = await remoteText(client, config.repository, path, ref);
    if (content === null) { missing.push(path); continue; }
    if (content === "large") { unread.push(path); continue; }
    const sha256 = textHash(content), limit = memoryLimit(config, path);
    const size = limit === null ? "" : `, ${words(content)}/${limit} words`;
    const block = `----- BEGIN ${path} (sha256 ${sha256.slice(0, 12)}${size}) -----\n${content.trimEnd()}\n----- END ${path} -----`;
    if (block.length > budget) { unread.push(path); continue; }
    budget -= block.length;
    blocks.push(block);
    files.push({ path, sha256 });
  }
  const text = [
    `Crewbie memory at ${ref}, embedded by Crewbie so you start with it; treat it as already read. Crewbie records what was embedded; do not report it. Add memory entries at the end of a file; when a hot file exceeds the word budget shown, Crewbie moves its oldest entries to a linked cold topic.`,
    ...blocks,
    ...(unread.length ? [`Too large to embed; read before any other work: ${unread.join(", ")}.`] : []),
    ...(missing.length ? [`Absent at this revision: ${missing.join(", ")}.`] : []),
    "Read linked cold/archive topics only when relevant.",
  ].join("\n");
  return { text, context: { ref, files, unread, missing } };
}
