import { open } from "node:fs/promises";
import { safePath } from "../core.js";
import { redact } from "./inventory.js";

/** A read-only tool Crewbie runs in-process for the model; the Copilot session gets no built-in tools. */
export interface RepoTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const READ_CHARS = 12_000;
const READ_BUDGET = 400_000;
const SEARCH_FILE_BYTES = 256_000;
const SEARCH_HITS = 60;
const LIST_ENTRIES = 400;
const SECRET = /(^|\/)(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|id_[a-z0-9]+|credentials(\.json)?|secrets?\.[a-z]+)$|\.(pem|key|p12|pfx|keystore|jks)$/i;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|mov|webm|wav|ogg|zip|gz|tgz|7z|rar|pdf|exe|dll|so|dylib|wasm|lockb)$/i;
const NOISE = /(^|\/)(node_modules|dist|build|coverage|\.next|\.vercel|vendor)\//;

const text = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const readable = (path: string) => !SECRET.test(path) && !BINARY.test(path) && !NOISE.test(path);

async function slice(root: string, path: string, start: number, bytes: number): Promise<string> {
  const handle = await open(await safePath(root, path), "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, start);
    const content = buffer.subarray(0, bytesRead);
    if (content.includes(0)) throw new Error(`${path} is binary.`);
    return content.toString("utf8");
  } finally { await handle.close(); }
}

/**
 * Lets the interview dig into the repository like a teammate would: list tracked file names, read text files and
 * search them. Limited to Git-visible files (gitignored and secret-looking files are never read), confined by
 * safePath (no escapes, symlinks or .git), bounded per call and per interview, and redacted.
 */
export function repositoryTools(root: string, files: readonly string[]): RepoTool[] {
  const tracked = new Set(files);
  let budget = READ_BUDGET;
  const spend = (content: string) => {
    if (budget <= 0) return "Read budget for this interview is spent; ask the human instead.";
    const kept = content.slice(0, budget);
    budget -= kept.length;
    return redact(kept);
  };
  return [
    {
      name: "repo_list_files",
      description: "List repository file paths (names only), optionally under a directory prefix or containing a substring.",
      parameters: { type: "object", properties: { prefix: { type: "string", description: "Directory prefix such as src/ or content/posts/" }, contains: { type: "string", description: "Case-insensitive substring of the path" } } },
      handler: async (args) => {
        const prefix = text(args.prefix).replace(/^\.?\//, "");
        const contains = text(args.contains).toLowerCase();
        const matched = files.filter((file) => !NOISE.test(file) && file.startsWith(prefix) && file.toLowerCase().includes(contains));
        return matched.length ? `${matched.slice(0, LIST_ENTRIES).join("\n")}${matched.length > LIST_ENTRIES ? `\n(${matched.length - LIST_ENTRIES} more; narrow the prefix)` : ""}` : "No matching files.";
      },
    },
    {
      name: "repo_read_file",
      description: `Read a repository text file (up to ${READ_CHARS} characters per call; use offset for more).`,
      parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "number", description: "Character offset to continue from" } }, required: ["path"] },
      handler: async (args) => {
        const path = text(args.path).replace(/^\.?\//, "");
        if (!tracked.has(path)) return `${path} is not a repository file; use repo_list_files.`;
        if (!readable(path)) return `${path} is not readable here (binary, generated or may hold secrets).`;
        const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
        const content = await slice(root, path, offset, READ_CHARS * 4);
        const chunk = content.slice(0, READ_CHARS);
        return spend(chunk) + (content.length > READ_CHARS ? `\n(truncated; continue with offset ${offset + Buffer.byteLength(chunk)})` : "");
      },
    },
    {
      name: "repo_search",
      description: "Case-insensitive literal search across repository text files; returns path:line: text matches.",
      parameters: { type: "object", properties: { text: { type: "string" }, prefix: { type: "string", description: "Optional directory prefix" } }, required: ["text"] },
      handler: async (args) => {
        const needle = text(args.text).toLowerCase();
        if (needle.length < 2) return "Search text must be at least 2 characters.";
        const prefix = text(args.prefix).replace(/^\.?\//, "");
        const hits: string[] = [];
        for (const file of files) {
          if (hits.length >= SEARCH_HITS) break;
          if (!file.startsWith(prefix) || !readable(file)) continue;
          let content: string;
          try { content = await slice(root, file, 0, SEARCH_FILE_BYTES); } catch { continue; }
          content.split(/\r?\n/).forEach((line, index) => {
            if (hits.length < SEARCH_HITS && line.toLowerCase().includes(needle)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 200)}`);
          });
        }
        return hits.length ? spend(hits.join("\n")) : "No matches.";
      },
    },
  ];
}
