/**
 * Guidance Copilot hosts attach on their own: `.github/copilot-instructions.md` and `AGENTS.md` (root, or nested for
 * its directory) always, `.github/instructions/*.instructions.md` when the working files match `applyTo`.
 * Telling an agent to read these files repeats context it already has.
 */
export function autoLoadedGuidance(path: string): boolean {
  return path === ".github/copilot-instructions.md" || /(^|\/)AGENTS\.md$/.test(path)
    || /^\.github\/instructions\/(?:[^/]+\/)*[^/]+\.instructions\.md$/.test(path);
}

// Anchored per token: an unanchored `(?:[\w.-]+\/)*` scan is cubic on long word runs.
const REFERENCE = /^(?:\.\/)?(?:(?:[\w.-]+\/)*AGENTS\.md|(?:\.github\/)?copilot-instructions\.md|\.github\/instructions\/(?:[\w.-]+\/)*(?:[\w.-]+\.instructions\.md)?|[\w.-]+\.instructions\.md)$/;
const HINT = /AGENTS\.md|copilot-instructions|\.instructions|\.github\/instructions/;
// Tokens split on whitespace, backticks, quotes, brackets and trailing punctuation; markdown link targets become their own token.
const tokens = (line: string) => line.split(/[\s`'"()[\]<>]+/).map((token) => token.replace(/[.,;:!?*_]+$/, "").replace(/^[*_]+/, ""));const DIRECTIVE = /\b(?:read|reread|load|open|review|consult|see|check|follow|refer to|apply|obey|respect|start with|begin with)\b/i;
const NEGATION = /\b(?:do not|don't|never|avoid|instead of)\b/i;
// Words that may remain on a line that only points at automatically loaded files.
const FILLER = new Set(("first then also always next before after any starting editing making work working changes edits coding and or plus the all every each "
  + "applicable relevant matching related repository repo project shared scoped path-specific file files under in inside from within both instruction instructions "
  + "guidance rules conventions carefully thoroughly fully please read reread load open review consult see check follow refer to apply obey respect start begin with").split(" "));
const pointerOnly = (rest: string) => rest.replace(/^\s*(?:\d+[.)]|[-*+])\s/, " ").toLowerCase().split(/[^a-z-]+/).every((word) => !word || FILLER.has(word));

export interface AutoLoadedPointer { references: string[]; pointerOnly: boolean }
/** A directive on this line to read automatically loaded guidance, or null. */
export function autoLoadedPointer(line: string): AutoLoadedPointer | null {
  if (!HINT.test(line) || !DIRECTIVE.test(line) || NEGATION.test(line)) return null;
  const references = tokens(line).filter((token) => REFERENCE.test(token));
  if (!references.length) return null;
  const rest = line.replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ").split(/([\s`'"()[\]<>]+)/)
    .map((part) => REFERENCE.test(part.replace(/[.,;:!?*_]+$/, "").replace(/^[*_]+/, "")) ? " " : part).join("");
  return { references, pointerOnly: pointerOnly(rest) };
}
/** Drops lines that only point at automatically loaded guidance; every other line, including code, is kept verbatim. */
export function removeAutoLoadedPointers(markdown: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let fenced = false;
  const kept = markdown.split(/(?<=\n)/).filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return true; }
    if (fenced || !autoLoadedPointer(line)?.pointerOnly) return true;
    removed.push(line.trim());
    return false;
  });
  return { text: kept.join(""), removed };
}
