import { stat } from "node:fs/promises";
import { posix } from "node:path";
import YAML from "yaml";
import { errorCode, optionalText, safePath } from "../core.js";

export const INSTRUCTION_STUDY = "https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd";
export interface InstructionSignal {
  code: "generic-only" | "duplicated-documentation" | "shared-profile-boilerplate" | "unverified-reference" | "missing-npm-script" | "unconditional-full-suite" | "missing-path-scope" | "broad-root-guidance";
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
const generic = /^(?:write clean(?:,? readable)?(?: and maintainable)? code|follow (?:coding )?best practices|be (?:thorough|helpful|concise)|ensure (?:high )?code quality|run (?:the )?tests|write (?:good |unit )?tests)[.!]?$/i;
function scopeDirectory(path: string): string {
  const marker = path.indexOf(".github/");
  return marker >= 0 ? path.slice(0, marker) : (posix.dirname(path) === "." ? "" : `${posix.dirname(path)}/`);
}

export async function assessInstructions(root: string, paths: readonly string[]): Promise<InstructionQuality> {
  const result: InstructionQuality = {
    basis: INSTRUCTION_STUDY,
    interpretation: "Advisory static heuristics, not a quality score or a causal prediction. The study does not establish a harmful word-count threshold or prove these individual patterns cause failures. Preserve justified policy; compare task outcomes before and after approved changes.",
    inspected: [], omitted: [], signals: [], signalsOmitted: 0,
  };
  const add = (signal: InstructionSignal) => {
    if (result.signals.length < 12) result.signals.push(signal);
    else result.signalsOmitted++;
  };
  const visible = new Set(paths);
  const priority = (path: string) => ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".crewbie/instructions.md"].includes(path) ? 0 : path.endsWith(".agent.md") ? 2 : 1;
  const instructions = paths.filter(instructionFile).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  const allDocs = paths.filter((path) => /(^|\/)(README|CONTRIBUTING)\.md$/i.test(path));
  const docs = allDocs.slice(0, 12);
  const manifests = paths.filter((path) => /(^|\/)package\.json$/.test(path));
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
    if (["AGENTS.md", ".github/copilot-instructions.md"].includes(path) && text.trim().split(/\s+/).length > 600) {
      add({ code: "broad-root-guidance", level: "advisory", path, line: 1,
        detail: "Always-loaded guidance exceeds Crewbie's 600-word review threshold, not a paper-established harmful limit.",
        recommendation: "Review relevance and domain scope. Keep necessary shared policy; move justified domain rules behind scoped instructions or nested AGENTS.md, with source reductions and destination edits reviewed together." });
    }
    const semantic = lines.map((line, index) => ({ text: line.replace(/^\s*[-*]\s*/, "").trim(), line: index + 1 }))
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
    const directory = scopeDirectory(path);
    const scopedManifests = manifests.filter((manifest) => manifest.startsWith(directory));
    let fenced = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
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
        if (scopedManifests.length && scopedManifests.every((manifest) => scripts.has(manifest)) && !line.includes("--if-present")) {
          for (const match of line.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
            if (scopedManifests.some((manifest) => scripts.get(manifest)!.has(match[1]!))) continue;
            add({ code: "missing-npm-script", level: "warning", path, line: index + 1,
              detail: "A literal npm run command names no script in any inspected package manifest within this instruction scope.",
              recommendation: "Verify the command and working directory against the current manifest. Correct stale guidance instead of creating a script solely to satisfy it." });
          }
        }
      }
    }
  }
  return result;
}
