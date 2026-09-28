import { type Config } from "../config.js";
import { GitHubError, record, slug, textHash } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { SHARED_HOT, SHARED_INDEX } from "./context.js";

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

async function remoteText(client: GitHubApi, repository: string, path: string, ref: string): Promise<string | null | "large"> {
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

/**
 * The role's required Crewbie memory at the launch revision, embedded in cloud-agent launch instructions.
 * Cloud agents told to read memory often skipped it; embedding makes the context deterministic, like the Actions jobs.
 */
export async function launchMemory(client: GitHubApi, config: Config, role: string, ref: string): Promise<string> {
  const blocks: string[] = [], missing: string[] = [], unread: string[] = [];
  let budget = LAUNCH_MEMORY_CHARACTERS;
  for (const path of launchMemoryPaths(config, role)) {
    const content = await remoteText(client, config.repository, path, ref);
    if (content === null) { missing.push(path); continue; }
    if (content === "large") { unread.push(path); continue; }
    const block = `----- BEGIN ${path} (sha256 ${textHash(content).slice(0, 12)}) -----\n${content.trimEnd()}\n----- END ${path} -----`;
    if (block.length > budget) { unread.push(path); continue; }
    budget -= block.length;
    blocks.push(block);
  }
  return [
    `Crewbie memory at ${ref}, embedded by Crewbie so you start with it; treat it as already read and cite these paths and hashes when reporting memory read.`,
    ...blocks,
    ...(unread.length ? [`Too large to embed; read before any other work: ${unread.join(", ")}.`] : []),
    ...(missing.length ? [`Absent at this revision (do not claim to have read them): ${missing.join(", ")}.`] : []),
    "Read linked cold/archive topics only when relevant.",
  ].join("\n");
}
