import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { posix } from "node:path";
import YAML from "yaml";
import { DEFAULT_GUIDANCE_LINES } from "../config.js";
import { errorCode, lines as lineCount, optionalText, safePath } from "../core.js";
import { autoLoadedGuidance, autoLoadedPointer } from "./auto-loaded.js";

export const INSTRUCTION_STUDY = "https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd";
export const SMELLS_STUDY = "https://arxiv.org/abs/2606.15828";
export interface InstructionSignal {
  code: "generic-only" | "duplicated-documentation" | "shared-profile-boilerplate" | "unverified-reference" | "missing-npm-script" | "missing-package-manifest" | "unconditional-full-suite" | "missing-path-scope" | "context-bloat" | "auto-loaded-reference" | "agent-only-context" | "lint-leakage" | "blind-reference" | "init-fossilization";
  level: "warning" | "advisory";
  path: string;
  line: number;
  related?: string;
  detail: string;
  recommendation: string;
}
export interface InstructionQuality {
  basis: string;
  interpretation: string;
  inspected: string[];
  omitted: { path: string; reason: string }[];
  signals: InstructionSignal[];
  signalsOmitted: number;
}
export function instructionFile(path: string): boolean {
  return path === ".crewbie/instructions.md" || /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|copilot-instructions\.md)$|\.instructions\.md$|(^|\/)\.github\/agents\/[^/]+\.agent\.md$|(^|\/)\.claude\/agents\/[^/]+\.md$/.test(path);
}
// AI guidance that setup may rewrite; Crewbie-managed agents and all non-AI files are excluded.
export function editableGuidance(path: string): boolean {
  return /^(?:(?:[a-zA-Z0-9._-]+\/)*(?:AGENTS|CLAUDE|GEMINI)\.md|\.github\/copilot-instructions\.md|\.github\/instructions\/[a-z0-9._/-]+\.instructions\.md|\.github\/agents\/(?!crewbie-)[a-z0-9._-]+\.agent\.md|\.claude\/agents\/[a-z0-9._-]+\.md)$/.test(path);
}
export function validateInstructionScope(path: string, content: string): void {
  if (!path.startsWith(".github/instructions/") || !path.endsWith(".instructions.md")) return;
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!header) throw new Error(`${path} needs YAML frontmatter with an explicit applyTo scope.`);
  const data: unknown = YAML.parse(header[1]!);
  if (typeof data !== "object" || data === null || !("applyTo" in data) || typeof data.applyTo !== "string"
    || !data.applyTo.trim() || data.applyTo.split(",").some((glob) => !glob.trim() || /(?:^|\/)\.\.(?:\/|$)|\\|^[\/~]|:/.test(glob.trim()))) {
    throw new Error(`${path} needs repository-relative applyTo globs.`);
  }
}
const normalize = (text: string) => text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const generic = /^(?:you are (?:a )?(?:(?:senior|experienced) )?(?:software )?(?:engineer|developer)|write (?:clean(?:,? readable)?(?: and maintainable)?|(?:high[- ]quality|good)) code(?: and tests)?|follow (?:coding )?best practices|be (?:thorough|helpful|concise)|ensure (?:high )?code quality|run (?:the )?tests|write (?:high[- ]quality|good |unit )?tests)[.!]?$/i;
function scopeDirectory(path: string): string {
  const marker = path.indexOf(".github/");
  return marker >= 0 ? path.slice(0, marker) : (posix.dirname(path) === "." ? "" : `${posix.dirname(path)}/`);
}
/** Files a host loads into every matching session, as opposed to custom-agent charters. */
function alwaysLoaded(path: string): boolean {
  return instructionFile(path) && !/\.agent\.md$|(^|\/)\.claude\/agents\//.test(path);
}
// Style rules deterministic tools enforce; the smells study found these in 62% of popular AGENTS.md files.
const LINT_RULE = /\b(?:\d+[- ]spaces?(?: indent(?:ation)?)?|spaces? (?:for|per) indent(?:ation)?|tabs? (?:for|over|instead of|not) (?:spaces|indent)|indent(?:ation)? (?:with|of|using) \d|semicolons?|single quotes|double quotes|trailing (?:commas?|whitespace)|(?:max(?:imum)? )?line length|\d+[- ]char(?:acter)?s?(?: line)?|camelCase|snake_case|PascalCase|kebab-case|import (?:order|sorting)|sort(?:ed)? imports)\b/i;
const LINTER_CONFIG = /^(?:\.eslintrc(?:\..+)?|eslint\.config\.[cm]?[jt]s|\.prettierrc(?:\..+)?|prettier\.config\.[cm]?[jt]s|biome\.jsonc?|\.editorconfig|\.?ruff\.toml|\.flake8|\.pylintrc|\.rubocop\.ya?ml|\.golangci\.ya?ml|\.?rustfmt\.toml|\.clang-format|\.stylelintrc(?:\..+)?|stylelint\.config\.[cm]?js|dprint\.json|\.markdownlint(?:\..+)?|\.swiftlint\.ya?ml|\.scalafmt\.conf|checkstyle\.xml|detekt\.ya?ml)$/;
const BLIND_FILLER = new Set(["see", "read", "also", "check", "refer", "consult", "follow", "more", "the", "and", "our", "here", "this", "file", "files", "doc", "docs", "documentation", "details", "info", "information", "guide", "please"]);
/** A file committed once and never touched while at least ten later commits landed; null when history is unavailable. */
function fossil(root: string, path: string): { commit: string; later: number } | null {
  try {
    const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const commits = git(["log", "--format=%H", "--follow", "--", path]).split("\n").filter(Boolean);
    if (commits.length !== 1) return null;
    const later = Number(git(["rev-list", "--count", `${commits[0]}..HEAD`]));
    return later >= 10 ? { commit: commits[0]!, later } : null;
  } catch { return null; }
}

export async function assessInstructions(root: string, paths: readonly string[], lineLimit = DEFAULT_GUIDANCE_LINES): Promise<InstructionQuality> {
  const result: InstructionQuality = {
    basis: `${INSTRUCTION_STUDY}; ${SMELLS_STUDY}`,
    interpretation: "Advisory static heuristics, not a quality score or a causal prediction. Gloaguen et al. found task/cost tradeoffs, not a harmful length threshold; the line limit follows Anthropic's recommendation used by the configuration-smells catalog. Preserve justified policy; compare task outcomes before and after approved changes.",
    inspected: [], omitted: [], signals: [], signalsOmitted: 0,
  };
  const signalCounts = new Map<string, number>();
  const add = (signal: InstructionSignal) => {
    const count = signalCounts.get(signal.path) ?? 0;
    signalCounts.set(signal.path, count + 1);
    if (count < 12) result.signals.push(signal);
    else result.signalsOmitted++;
  };
  const visible = new Set(paths);
  const priority = (path: string) => ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".crewbie/instructions.md"].includes(path) ? 0 : path.endsWith(".agent.md") ? 2 : 1;
  const instructions = paths.filter(instructionFile).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  const allDocs = paths.filter((path) => /(^|\/)(README|CONTRIBUTING)\.md$/i.test(path));
  const docs = allDocs.slice(0, 12);
  const manifests = paths.filter((path) => /(^|\/)package\.json$/.test(path));
  const linters = paths.filter((path) => LINTER_CONFIG.test(posix.basename(path))).slice(0, 3);
  const content = new Map<string, string>();
  let remaining = 512_000;
  const read = async (path: string): Promise<string | null> => {
    if (content.has(path)) return content.get(path)!;
    const absolute = await safePath(root, path);
    let size: number;
    try { size = (await stat(absolute)).size; }
    catch (error) {
      if (!errorCode(error, "ENOENT")) throw error;
      result.omitted.push({ path, reason: "File disappeared during assessment." }); return null;
    }
    if (size > 64_000 || size > remaining) {
      result.omitted.push({ path, reason: "Not inspected because of the assessment's byte budget; size alone is not a quality finding." });
      return null;
    }
    remaining -= size;
    const text = await optionalText(absolute);
    if (text === null || text.includes("\0")) {
      result.omitted.push({ path, reason: "Not readable as ordinary text." }); return null;
    }
    content.set(path, text);
    return text;
  };
  for (const path of instructions.slice(0, 32)) {
    if (await read(path) !== null) result.inspected.push(path);
  }
  for (const path of instructions.slice(32)) result.omitted.push({ path, reason: "Instruction-file count exceeds the bounded assessment window." });
  for (const path of docs) await read(path);
  for (const path of allDocs.slice(12)) result.omitted.push({ path, reason: "Documentation count exceeds the overlap-check window." });
  const scripts = new Map<string, Set<string>>();
  for (const path of manifests.slice(0, 20)) {
    const text = await read(path);
    if (text === null) continue;
    let data: unknown;
    try { data = JSON.parse(text) as unknown; }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      result.omitted.push({ path, reason: "Invalid package JSON; script references were not verified against it." }); continue;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      result.omitted.push({ path, reason: "Package manifest is not an object; script references remain unverified." }); continue;
    }
    const declared = "scripts" in data ? data.scripts : undefined;
    if (declared !== undefined && (typeof declared !== "object" || declared === null || Array.isArray(declared))) {
      result.omitted.push({ path, reason: "Invalid scripts declaration; script references remain unverified." }); continue;
    }
    scripts.set(path, new Set(Object.keys(declared ?? {})));
  }
  for (const path of manifests.slice(20)) result.omitted.push({ path, reason: "Manifest count exceeds the script-check window." });
  for (const path of result.inspected) {
    const text = content.get(path)!;
    const lines = text.split(/\r?\n/);
    if (path.startsWith(".github/instructions/") && path.endsWith(".instructions.md")) {
      try { validateInstructionScope(path, text); }
      catch (error) {
        add({ code: "missing-path-scope", level: "warning", path, line: 1,
          detail: error instanceof Error ? error.message : "Invalid path-scoped instruction header.",
          recommendation: "Specify valid applyTo globs for the intended domain before moving repository-wide rules here." });
      }
    }
    if (alwaysLoaded(path) && lineCount(text) > lineLimit) {
      add({ code: "context-bloat", level: "warning", path, line: lineLimit + 1,
        detail: `Always-loaded guidance has ${lineCount(text)} lines, over the ${lineLimit}-line limit (Anthropic's recommendation for always-loaded instruction files; configuration smell "Context Bloat").`,
        recommendation: "Remove linter-enforced and rare-task rules first, then move justified domain rules behind scoped instructions or nested AGENTS.md, with source reductions and destination edits reviewed together." });
    }
    const history = fossil(root, path);
    if (history) {
      add({ code: "init-fossilization", level: "advisory", path, line: 1,
        detail: `Committed once (${history.commit.slice(0, 7)}) and never updated while the repository gained ${history.later} commits since (configuration smell "Init Fossilization").`,
        recommendation: "Check its commands, paths and conventions against the current repository; correct or remove stale claims and review the file periodically." });
    }
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0];
    const frontmatterEndLine = frontmatter === undefined ? 0 : lines.findIndex((line, index) => index > 0 && line.trim() === "---") + 1;
    const semantic = lines.map((line, index) => ({ text: line.replace(/^\s*[-*]\s*/, "").trim(), line: index + 1 }))
      .filter((line) => line.line > frontmatterEndLine)
      .filter((line) => line.text && !line.text.startsWith("#") && !line.text.startsWith("<!--"));
    if (semantic.length && semantic.every((line) => generic.test(line.text))) {
      add({ code: "generic-only", level: "advisory", path, line: semantic[0]!.line,
        detail: "The file contains only generic advice, without a concrete command, local constraint or context pointer.",
        recommendation: "Check whether it adds useful context. Prefer a non-obvious repository convention or a scoped pointer; do not pad it to meet a length target." });
    }
    let lineNumber = 1;
    let sharedProfileReported = false;
    for (const paragraph of text.split(/(\r?\n\s*\r?\n)/)) {
      const normalized = normalize(paragraph);
      if (normalized.split(" ").length >= 12 && normalized.length >= 80 && !/^\s*#/.test(paragraph)) {
        const duplicate = docs.find((doc) => doc !== path && content.has(doc) && normalize(content.get(doc)!).includes(normalized));
        if (duplicate) add({
          code: "duplicated-documentation", level: "advisory", path, line: lineNumber, related: duplicate,
          detail: "A substantial passage repeats existing repository documentation. This is an exact normalized overlap, not a claim that repetition caused a failure.",
          recommendation: "Consider a short pointer explaining when to read the existing document. Retain necessary standalone constraints where the contexts differ.",
        });
        if (path.endsWith(".agent.md") && !sharedProfileReported) {
          const other = result.inspected.find((candidate) => candidate !== path && candidate.endsWith(".agent.md")
            && posix.dirname(candidate) === posix.dirname(path) && normalize(content.get(candidate)!).includes(normalized));
          if (other) {
            sharedProfileReported = true;
            add({ code: "shared-profile-boilerplate", level: "advisory", path, line: lineNumber, related: other,
              detail: "A substantial instruction block is repeated across specialist profiles. This indicates shared maintenance, not proven runtime harm.",
              recommendation: "Consider one explicit shared-policy pointer, keeping domain-specific checks and non-negotiables in each charter. Preserve access for agents that run independently." });
          }
        }
      }
      lineNumber += (paragraph.match(/\n/g) ?? []).length;
    }
    // Files Copilot reads; other hosts (Claude, Gemini) do not attach .github guidance, so their pointers are needed.
    const copilotHost = /^\.github\/(?:copilot-instructions\.md|instructions\/.+\.instructions\.md|agents\/(?!crewbie-)[^/]+\.agent\.md)$|(^|\/)AGENTS\.md$/.test(path);
    const directory = scopeDirectory(path);
    const scopedManifests = manifests.filter((manifest) => manifest.startsWith(directory));
    let fenced = false;
    let lintCount = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      const pointer = !fenced && copilotHost ? autoLoadedPointer(line) : null;
      const targets = pointer?.references.map((reference) => reference.replace(/^\.\//, "").replace(/^copilot-instructions\.md$/, ".github/copilot-instructions.md")
        .replace(/^([\w.-]+\.instructions\.md)$/, ".github/instructions/$1")).filter((target) => target !== path) ?? [];
      if (pointer && targets.length) {
        const missing = targets.filter((target) => autoLoadedGuidance(target) && !visible.has(target));
        add({ code: "auto-loaded-reference", level: "warning", path, line: index + 1, related: targets[0]!,
          detail: `Tells the agent to read ${targets.join(", ")}, which Copilot already attaches: repository-wide instructions and AGENTS.md always, path-specific instructions when the working files match applyTo.${missing.length ? ` ${missing.join(", ")} does not exist.` : ""}`,
          recommendation: pointer.pointerOnly
            ? "Remove the line. Adopted agents are cleaned on install; the archive keeps the original."
            : "Remove only the pointer and keep the rest of the line. If the agent needs rules that no automatically loaded file contains, put them in a path-scoped .github/instructions/<domain>.instructions.md." });
      }
      if (!fenced && path.startsWith(".github/agents/") && copilotHost && /\b(?:read|consult|follow|review|see)\b/i.test(line)) {
        for (const match of line.matchAll(/`([\w./-]+\.md)`|\]\(([\w./-]+\.md)\)/g)) {
          const target = posix.normalize(match[1] ?? match[2]!).replace(/^\.\//, "");
          if (autoLoadedGuidance(target) || target.startsWith(".crewbie/") || target.startsWith(".github/agents/") || !visible.has(target)) continue;
          add({ code: "agent-only-context", level: "advisory", path, line: index + 1, related: target,
            detail: "Only this agent is told to read this document; other agents and Copilot chat working on the same files do not get it.",
            recommendation: "If it holds rules for specific paths, consider a path-scoped .github/instructions/<domain>.instructions.md with applyTo globs so Copilot loads them automatically, then drop the pointer." });
        }
      }
      if (!fenced && !/^\s*(?:#|\|)/.test(line)) {
        if (LINT_RULE.test(line) && lintCount < 3) {
          lintCount++;
          add({ code: "lint-leakage", level: linters.length ? "warning" : "advisory", path, line: index + 1, ...(linters.length ? { related: linters[0]! } : {}),
            detail: linters.length
              ? `A style rule that ${linters.join(", ")} can enforce is repeated in agent guidance (configuration smell "Lint Leakage").`
              : `A style rule a linter or formatter could enforce is in agent guidance, and no linter or formatter configuration was found (configuration smell "Lint Leakage").`,
            recommendation: linters.length
              ? "Delete the rule from guidance when the tool enforces it; the tool and its CI check are the enforcement."
              : "Enforce it with a linter or formatter and a CI check, then delete it from guidance." });
        }
        const references = [...line.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)|`([^`\s]+\.(?:md|mdx|txt|rst|adoc))`/gi)]
          .map((match) => match[1] ?? match[2]!).filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target) && /\.(?:md|mdx|txt|rst|adoc)(?:#.*)?$/i.test(target));
        if (references.length && !pointer) {
          const rest = line.replace(/\[([^\]]*)\]\([^)]*\)/g, (_, text: string) => /[/\\]|\.\w{2,4}$/.test(text) ? " " : ` ${text} `).replace(/`[^`]*`/g, " ").toLowerCase().match(/[a-z]{3,}/g) ?? [];
          if (rest.filter((word) => !BLIND_FILLER.has(word)).length < 2) {
            add({ code: "blind-reference", level: "advisory", path, line: index + 1, related: references[0]!,
              detail: `References ${references.join(", ")} without saying what it contains or when to read it; agents often ignore such pointers (configuration smell "Blind References").`,
              recommendation: "Add one line on what the document holds and when an agent should read it, or remove the reference if it is not needed." });
          }
        }
      }
      if (!fenced) for (const match of line.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const raw = match[1]!;
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/|~)/i.test(raw) || /[<>{}$*]/.test(raw)) continue;
        let target: string;
        try { target = decodeURIComponent(raw.split(/[?#]/)[0]!); }
        catch (error) { if (error instanceof URIError) continue; throw error; }
        if (!target) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(path), target)).replace(/\/+$/, "") || ".";
        if (resolved === "." || resolved.startsWith("../") || visible.has(resolved) || paths.some((candidate) => candidate.startsWith(`${resolved}/`))) continue;
        add({ code: "unverified-reference", level: "warning", path, line: index + 1,
          detail: "A literal relative Markdown link has no target in the visible, non-ignored repository file index.",
          recommendation: "Verify the link relative to this instruction file. Correct stale paths, or state when an ignored/generated target becomes available." });
      }
      if (!/\b(?:don't|do not|avoid|never)\b/i.test(line)) {
        if (/\b(?:always|every change)\b/i.test(line) && /\b(?:full|entire|all)\b.*\btests?\b/i.test(line) && !/\b(?:merge|release|compliance|security|CI)\b/i.test(line)) {
          add({ code: "unconditional-full-suite", level: "advisory", path, line: index + 1,
            detail: "The text appears to require full-suite work unconditionally; faithful compliance may increase cost.",
            recommendation: "Confirm the intent. Scope routine checks to changed behavior where appropriate, while preserving explicit merge, release and compliance gates." });
        }
        if (!line.includes("--if-present")) {
          const npmScripts = [...line.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)];
          if (npmScripts.length) {
            if (!scopedManifests.length) {
              add({ code: "missing-package-manifest", level: "warning", path, line: index + 1,
                detail: "A literal npm run command has no package.json in this instruction scope to establish its working directory or script.",
                recommendation: "Verify the command's working directory. Add the relevant package manifest to the repository or make the guidance name the intended package location." });
            } else if (scopedManifests.every((manifest) => scripts.has(manifest))) {
              for (const match of npmScripts) {
                if (scopedManifests.some((manifest) => scripts.get(manifest)!.has(match[1]!))) continue;
                add({ code: "missing-npm-script", level: "warning", path, line: index + 1,
                  detail: "A literal npm run command names no script in any inspected package manifest within this instruction scope.",
                  recommendation: "Verify the command and working directory against the current manifest. Correct stale guidance instead of creating a script solely to satisfy it." });
              }
            }
          }
        }
      }
    }
  }
  return result;
}
