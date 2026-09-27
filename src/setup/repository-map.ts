import { execFileSync } from "node:child_process";

/**
 * A names-only map of the working tree, so generated guidance can be checked against paths that actually exist.
 * No file contents are read; the model sees directories and workspaces, and Crewbie checks cited paths locally.
 */
export interface RepositoryMap {
  /** Non-ignored file paths for local checks. Not serialized into saved proposals; absent after reloading one. */
  files?: string[];
  truncated: boolean;
  directories: string[];
  /** Directories below the root that hold their own package or project manifest. */
  workspaces: string[];
}

const MAP_FILES = 20_000;
const PROMPT_DIRECTORIES = 400;
const PROMPT_WORKSPACES = 100;
const DIRECTORY_DEPTH = 4;
const MANIFEST = /(^|\/)(?:package\.json|pyproject\.toml|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|Gemfile|[^/]+\.csproj|[^/]+\.fsproj)$/;
const GENERATED = /^(?:\.crewbie\/|\.github\/agents\/crewbie-)/;

export function repositoryMap(paths: string[]): RepositoryMap {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let depth = 1; depth <= Math.min(parts.length, DIRECTORY_DEPTH); depth++) directories.add(parts.slice(0, depth).join("/"));
  }
  const workspaces = [...new Set(paths.filter((path) => MANIFEST.test(path) && path.includes("/"))
    .map((path) => path.slice(0, path.lastIndexOf("/")))
    .filter((dir) => !/(^|\/)(?:node_modules|vendor|dist|build|fixtures?|examples?|test|tests|__tests__)(\/|$)/.test(dir)))].sort();
  const truncated = paths.length > MAP_FILES;
  const map: RepositoryMap = { truncated, directories: [...directories].sort(), workspaces };
  Object.defineProperty(map, "files", { value: truncated ? [] : [...paths].sort(), enumerable: false });
  return map;
}

/** The map of a checkout: tracked and untracked, non-ignored names. */
export function workingTree(root: string): RepositoryMap {
  const output = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return repositoryMap([...new Set(output.split("\0").filter(Boolean))]);
}

/** The directory summary and workspaces a prompt may carry, bounded. */
export function promptMap(map: RepositoryMap): { directories: string[]; directoriesOmitted: number; workspaces: string[]; workspacesOmitted: number } {
  return {
    directories: map.directories.slice(0, PROMPT_DIRECTORIES), directoriesOmitted: Math.max(0, map.directories.length - PROMPT_DIRECTORIES),
    workspaces: map.workspaces.slice(0, PROMPT_WORKSPACES), workspacesOmitted: Math.max(0, map.workspaces.length - PROMPT_WORKSPACES),
  };
}

const REFERENCE = /(?<![\w/.:@~-])((?:\.{0,2}[\w@-][\w.@-]*\/)+(?:[\w.*@-]*[\w*])?\/?)(?![\w/(])/g;
const PROSE = /^(?:and\/or|either\/or|input\/output|read\/write|yes\/no|on\/off|true\/false|client\/server|ci\/cd|i\/o|n\/a|w\/o|pass\/fail|get\/set|frontend\/backend|front-end\/back-end|pros\/cons|[a-z]+\/[a-z]+)$/i;

/** Repository-relative path references in generated text: backticked code spans, and path-shaped words outside prose pairs. */
export function pathReferences(text: string): string[] {
  const found = new Set<string>();
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!.trim());
  const withoutUrls = text.replace(/(?<![\w+.-])[a-z][\w+.-]{0,30}:\/\/\S+/gi, " ");
  for (const [candidate, strict] of [...spans.map((span) => [span, true] as const), ...[...withoutUrls.matchAll(REFERENCE)].map((match) => [match[1]!, false] as const)]) {
    const path = candidate.replace(/^\.\//, "").replace(/[.,;:)]+$/, "");
    if (!path.includes("/") || path.startsWith("/") || /\s|:\/\/|^[\w-]+\/[\w-]+#\d+$/.test(path) || path.startsWith("..")) continue;
    const last = path.replace(/\/$/, "").split("/").at(-1)!;
    // Outside code spans, only unmistakable paths: a file with an extension, a trailing slash, a glob, or three or more segments.
    if (!strict && PROSE.test(path)) continue;
    if (!strict && !(/\.[\w]+$/.test(last) || path.endsWith("/") || path.includes("*") || path.split("/").length >= 3)) continue;
    found.add(path);
  }
  return [...found];
}

/** True when the path, directory or glob prefix names something in the working tree. */
export function pathExists(map: RepositoryMap, reference: string): boolean {
  const glob = reference.indexOf("*");
  const base = (glob === -1 ? reference : reference.slice(0, glob)).replace(/\/$/, "");
  if (!base) return true;
  const files = map.files ?? [];
  if (glob !== -1) return files.some((file) => file.startsWith(base)) || map.directories.some((dir) => dir.startsWith(base));
  return files.includes(base) || map.directories.includes(base) || files.some((file) => file.startsWith(`${base}/`));
}

/** Cited paths absent from the working tree, excluding files the proposal itself creates. */
export function missingPaths(map: RepositoryMap, text: string, created: string[] = []): string[] {
  if (map.truncated || !map.files) return [];
  return pathReferences(text).filter((path) => !GENERATED.test(path) && !created.includes(path.replace(/\/$/, "")) && !pathExists(map, path));
}

/** Workspaces that no role names by path or directory name. */
export function unownedWorkspaces(map: RepositoryMap, roleTexts: string[]): string[] {
  const text = roleTexts.join("\n").toLowerCase();
  return map.workspaces.filter((workspace) => {
    const name = workspace.split("/").at(-1)!.toLowerCase();
    return !text.includes(workspace.toLowerCase()) && !(name.length >= 3 && new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`).test(text));
  });
}
