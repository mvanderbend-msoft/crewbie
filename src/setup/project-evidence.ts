import { stat } from "node:fs/promises";
import { errorCode, optionalText, safePath } from "../core.js";
import { redact } from "./inventory.js";

/**
 * Bounded, redacted build evidence so setup can ground stack, commands and guidance in the repository
 * instead of asking the human: manifest summaries, CI workflow text and root file names. Nothing is executed.
 */
export interface ProjectEvidence {
  manifests: {
    path: string;
    packageManager?: string;
    scripts?: Record<string, string>;
    dependencies?: string[];
    engines?: Record<string, string>;
    /** Non-JSON manifests: redacted text, truncated to the per-file budget. */
    content?: string;
  }[];
  workflows: { path: string; content: string }[];
  rootFiles: string[];
  omitted: { path: string; reason: string }[];
}

const MANIFEST = /(^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|Gemfile|deno\.jsonc?|pubspec\.yaml|[^/]+\.csproj)$/;
const EXCLUDED = /(^|\/)(?:node_modules|vendor|dist|build|target|coverage|fixtures?|__fixtures__|examples?|samples?|test|tests|__tests__)\//;
const MAX_MANIFESTS = 12;
const MAX_WORKFLOWS = 8;
const FILE_BYTES = 64_000;
const TEXT_CHARACTERS = 8_000;
const TOTAL_CHARACTERS = 96_000;
const LOCKFILES: [string, string][] = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["package-lock.json", "npm"]];

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries.map(([key, text]) => [key, redact(text)])) : undefined;
}

export async function projectEvidence(root: string, paths: string[]): Promise<ProjectEvidence> {
  const result: ProjectEvidence = { manifests: [], workflows: [], rootFiles: paths.filter((path) => !path.includes("/")).slice(0, 80), omitted: [] };
  let remaining = TOTAL_CHARACTERS;
  const read = async (path: string): Promise<string | null> => {
    try {
      if ((await stat(await safePath(root, path))).size > FILE_BYTES) { result.omitted.push({ path, reason: "Larger than 64 KB." }); return null; }
    } catch (error) {
      if (errorCode(error, "ENOENT")) { result.omitted.push({ path, reason: "File disappeared during assessment." }); return null; }
      throw error;
    }
    const text = await optionalText(await safePath(root, path));
    if (text === null || text.includes("\0")) { result.omitted.push({ path, reason: "Not ordinary text." }); return null; }
    return text;
  };
  const manifests = paths.filter((path) => MANIFEST.test(path) && !EXCLUDED.test(path))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const [index, path] of manifests.entries()) {
    if (index >= MAX_MANIFESTS || remaining <= 0) { result.omitted.push({ path, reason: "Outside the manifest budget." }); continue; }
    const text = await read(path);
    if (text === null) continue;
    let entry: ProjectEvidence["manifests"][number];
    if (path.endsWith("package.json")) {
      let manifest: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("Not an object.");
        manifest = parsed as Record<string, unknown>;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        result.omitted.push({ path, reason: "Invalid package.json." }); continue;
      }
      const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
      const lock = LOCKFILES.find(([name]) => paths.includes(`${directory}${name}`) || paths.includes(name));
      const declared = typeof manifest.packageManager === "string" ? redact(manifest.packageManager) : undefined;
      const scripts = stringMap(manifest.scripts);
      const engines = stringMap(manifest.engines);
      const dependencies = ["dependencies", "devDependencies", "peerDependencies"].flatMap((field) =>
        Object.entries(stringMap(manifest[field]) ?? {}).map(([name, version]) => `${name}@${version}`)).slice(0, 80);
      entry = {
        path, ...(declared ?? lock ? { packageManager: declared ?? lock![1] } : {}),
        ...(scripts ? { scripts } : {}), ...(dependencies.length ? { dependencies } : {}), ...(engines ? { engines } : {}),
      };
    } else {
      const safe = redact(text);
      entry = { path, content: safe.length > TEXT_CHARACTERS ? `${safe.slice(0, TEXT_CHARACTERS)}\n[truncated]` : safe };
    }
    remaining -= JSON.stringify(entry).length;
    result.manifests.push(entry);
  }
  const workflows = paths.filter((path) => /^\.github\/workflows\/(?!crewbie-)[^/]+\.ya?ml$/.test(path));
  for (const [index, path] of workflows.entries()) {
    if (index >= MAX_WORKFLOWS || remaining <= 0) { result.omitted.push({ path, reason: "Outside the CI workflow budget." }); continue; }
    const text = await read(path);
    if (text === null) continue;
    const safe = redact(text);
    const content = safe.length > TEXT_CHARACTERS * 2 ? `${safe.slice(0, TEXT_CHARACTERS * 2)}\n[truncated]` : safe;
    remaining -= content.length;
    result.workflows.push({ path, content });
  }
  return result;
}

/** Short stack hint for the setup interview, e.g. "react, vite; npm". */
export function detectedStack(evidence: ProjectEvidence | undefined): string {
  const root = evidence?.manifests.find((manifest) => manifest.path === "package.json") ?? evidence?.manifests[0];
  if (!root) return "";
  const names = (root.dependencies ?? []).map((dependency) => dependency.slice(0, dependency.lastIndexOf("@") > 0 ? dependency.lastIndexOf("@") : undefined))
    .filter((name) => !name.startsWith("@types/")).slice(0, 8);
  return [names.join(", "), root.packageManager].filter(Boolean).join("; ") || root.path;
}
