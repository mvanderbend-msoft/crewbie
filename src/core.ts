import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class GitHubError extends Error {
  constructor(public readonly status: number, public readonly requestId: string | null) {
    const advice = status === 401 ? "Authenticate with a user-authorized GitHub credential."
      : status === 403 ? "Check repository permissions, policy, and rate limits."
        : status === 404 ? "Check the repository, branch, profile, and token access."
          : status === 429 ? "Wait for the rate limit to reset before retrying."
            : "Check GitHub availability and the documented preview interface.";
    super(`GitHub HTTP ${status}. ${advice}${requestId ? ` Request: ${requestId}.` : ""}`);
    this.name = "GitHubError";
  }
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${name} must be text${allowEmpty ? "" : " and cannot be empty"}.`);
  return value;
}
export function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list.`);
  return value.map((item) => string(item, name));
}
export function integer(value: unknown, name: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
export function slug(value: unknown, name: string): string {
  const result = string(value, name);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(result)) throw new Error(`${name} must start with a letter and contain only lowercase letters, digits, and hyphens.`);
  return result;
}
export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function textHash(value: string): string {
  return hash(value.replaceAll("\r\n", "\n"));
}
export function matchesTextHash(value: string, digest: unknown): boolean {
  const lf = value.replaceAll("\r\n", "\n");
  // Accept pre-normalization manifests and proposals from either checkout style.
  return digest === hash(lf) || digest === hash(value) || digest === hash(lf.replaceAll("\n", "\r\n"));
}
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
export function words(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}
export function bounded(value: string, limit: number, name: string): void {
  if (words(value) > limit) throw new Error(`${name} exceeds ${limit} words. Curate or split it; nothing was truncated.`);
}
// GitHub's documented maximum for a custom agent's Markdown prompt below the frontmatter:
// https://docs.github.com/en/copilot/reference/custom-agents-configuration
export const AGENT_PROMPT_CHARACTERS = 30_000;
export function agentPromptLength(profile: string): number {
  const text = profile.replace(/^\uFEFF/, "");
  const header = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return (header ? text.slice(header[0].length) : text).length;
}
export function agentPrompt(profile: string, name: string, remedy = "Shorten it; nothing was truncated."): void {
  const length = agentPromptLength(profile);
  if (length > AGENT_PROMPT_CHARACTERS) throw new Error(`${name} prompt has ${length} characters; GitHub custom agents allow at most ${AGENT_PROMPT_CHARACTERS}. ${remedy}`);
}
export function errorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
export async function optionalText(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if (errorCode(error, "ENOENT")) return null;
    throw error;
  }
}
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

/** Reject traversal and symlink parents before reading or changing repository files. */
export async function safePath(root: string, file: string): Promise<string> {
  if (!file || isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes("\0")) throw new Error(`Unsafe repository path: ${file}`);
  const base = await realpath(root);
  const target = resolve(base, file.replaceAll("\\", sep).replaceAll("/", sep));
  const rel = relative(base, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error(`Path leaves repository: ${file}`);
  if (rel.split(sep).some((part) => part.toLowerCase() === ".git")) throw new Error("Crewbie does not read or write Git internals through repository paths.");
  let current = base;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlinks are not allowed in managed paths: ${file}`);
    } catch (error) {
      if (!errorCode(error, "ENOENT")) throw error;
    }
  }
  return target;
}
export async function writeAtomic(root: string, file: string, content: string): Promise<void> {
  const target = await safePath(root, file);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx" });
  await rename(temporary, target);
}
