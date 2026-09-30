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
const MANIFEST = /(^|\/)(?:package\.json|Package\.swift|pyproject\.toml|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|Gemfile|[^/]+\.csproj|[^/]+\.fsproj)$/;
const XCODE_MANIFEST = /(^|\/)[^/]+\.(?:xcodeproj\/project\.pbxproj|xcworkspace\/contents\.xcworkspacedata)$/;
const XCODE_CONTAINER = /(^|\/)[^/]+\.(?:xcodeproj|xcworkspace)(\/|$)/;
const GENERATED = /^(?:\.crewbie\/|\.github\/agents\/crewbie-)/;

/** Xcode bundles describe the containing project directory, not a workspace inside the bundle. */
function workspaceDirectory(path: string): string | undefined {
  const xcode = XCODE_MANIFEST.exec(path);
  const directory = xcode ? path.slice(0, xcode.index) : MANIFEST.test(path) && path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return directory && !XCODE_CONTAINER.test(directory) ? directory : undefined;
}

export function repositoryMap(paths: string[]): RepositoryMap {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let depth = 1; depth <= Math.min(parts.length, DIRECTORY_DEPTH); depth++) directories.add(parts.slice(0, depth).join("/"));
  }
  const workspaces = [...new Set(paths.map(workspaceDirectory).filter((dir): dir is string => dir !== undefined)
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

/**
 * Repository-relative path references in generated text: backticked code spans, and path-shaped words outside prose pairs.
 * Module specifiers (node:x/y, @scope/pkg), placeholders (NNNN, <name>) and slash-joined words are not paths.
 * An extensionless span counts only when its first segment is one of `roots`, the repository's top-level directories.
 */
export function pathReferences(text: string, roots: ReadonlySet<string> = new Set()): string[] {
  const found = new Set<string>();
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!.trim());
  const withoutUrls = text.replace(/`[^`\n]+`/g, " ").replace(/(?<![\w+.-])[a-z][\w+.-]{0,30}:\/\/\S+/gi, " ");
  for (const [candidate, strict] of [...spans.map((span) => [span, true] as const), ...[...withoutUrls.matchAll(REFERENCE)].map((match) => [match[1]!, false] as const)]) {
    const path = candidate.replace(/^\.\//, "").replace(/[.,;:)]+$/, "");
    if (!path.includes("/") || path.startsWith("/") || path.startsWith("@") || path.startsWith("..") || /[\s:<>{}]|^[\w-]+\/[\w-]+#\d+$|N{3,}|X{3,}|\.\.\./.test(path)) continue;
    const last = path.replace(/\/$/, "").split("/").at(-1)!;
    const unmistakable = /\.[A-Za-z0-9]+$/.test(last) || path.endsWith("/") || path.includes("*");
    if (strict ? !unmistakable && !roots.has(path.split("/")[0]!) : PROSE.test(path) || !(unmistakable || (path.split("/").length >= 3 && roots.has(path.split("/")[0]!)))) continue;
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
  if (files.includes(base) || map.directories.includes(base) || files.some((file) => file.startsWith(`${base}/`))) return true;
  // Guidance inside a workspace often cites paths relative to that workspace (src/render.js for frontend/src/render.js).
  return files.some((file) => file.endsWith(`/${base}`) || file.includes(`/${base}/`));
}

/** Cited paths absent from the working tree, excluding files the proposal itself creates. */
export function missingPaths(map: RepositoryMap, text: string, created: string[] = []): string[] {
  if (map.truncated || !map.files) return [];
  const roots = new Set(map.directories.filter((dir) => !dir.includes("/")));
  return pathReferences(text, roots).filter((path) => !GENERATED.test(path) && !created.includes(path.replace(/\/$/, "")) && !pathExists(map, path));
}

/** Workspaces that no role names by path or directory name. */
export function unownedWorkspaces(map: RepositoryMap, roleTexts: string[]): string[] {
  const text = roleTexts.join("\n").toLowerCase();
  return map.workspaces.filter((workspace) => {
    const name = workspace.split("/").at(-1)!.toLowerCase();
    return !text.includes(workspace.toLowerCase()) && !(name.length >= 3 && new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`).test(text));
  });
}
