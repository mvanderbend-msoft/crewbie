import { parseDocument, isMap, isSeq } from "yaml";
import { agentArchivePath, type Config, type Role } from "../config.js";
import { agentPrompt, optionalText, safePath } from "../core.js";
import { MANAGED_END, profile } from "./templates.js";
import { removeAutoLoadedPointers } from "./auto-loaded.js";

export async function roleProfile(root: string, role: Role, config: Config): Promise<string> {
  const generated = profile(role, config);
  if (!role.sourceAgent) return generated;
  const original = await optionalText(await safePath(root, agentArchivePath(role.sourceAgent)))
    ?? await optionalText(await safePath(root, role.sourceAgent));
  if (original === null) throw new Error(`Restore the original or archived agent before updating ${role.id}: ${role.sourceAgent}`);
  return adoptedProfile(role, config, original);
}

export function adoptedProfile(role: Role, config: Config, original: string): string {
  const generated = profile(role, config);
  const text = original.replace(/^\uFEFF/, "");
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!header && text.startsWith("---")) throw new Error(`Agent frontmatter is incomplete: ${role.sourceAgent}`);
  const document = parseDocument(header ? header[1]! : `name: crewbie-${role.id}\n`, { uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error(`Agent frontmatter must be a valid YAML mapping: ${role.sourceAgent}`);
  if (document.has("tools") && !isSeq(document.get("tools"))) throw new Error(`Preserve tool restrictions by converting ${role.sourceAgent}'s tools to a reviewed YAML list before adoption.`);
  document.set("name", `crewbie-${role.id}`);
  if (!document.has("description")) document.set("description", role.purpose);
  // Assignment and an inherited frontmatter model must not disagree.
  if (document.has("model")) document.set("model", role.model);
  const handoffs = document.get("handoffs");
  if (isSeq(handoffs)) for (const handoff of handoffs.items) {
    if (!isMap(handoff)) continue;
    const target = handoff.get("agent");
    const adopted = config.roles.find((candidate) => candidate.sourceAgent
      && candidate.sourceAgent.split("/").at(-1)?.replace(/(?:\.agent)?\.md$/, "") === target);
    if (adopted) handoff.set("agent", `crewbie-${adopted.id}`);
  }
  // Pointers to guidance Copilot already attaches only repeat context; the archive keeps the original.
  const body = removeAutoLoadedPointers(header ? text.slice(header[0].length) : text).text;
  const result = `---\n${document.toString()}---\n${body}\n\n${generated.replace(/^---\n[\s\S]*?\n---\n# [^\n]*\n/, "## Crewbie integration\n")}`;
  agentPrompt(result, `Adopted ${role.id} charter`, `Shorten the original ${role.sourceAgent} and rerun init, leaving room for Crewbie integration. No original instructions were truncated or archived.`);
  return result;
}

const START = /<!-- crewbie:managed:start[^>]*-->/g;
function managedBlock(text: string): [number, number] | null {
  const starts = [...text.matchAll(START)];
  const end = text.indexOf(MANAGED_END);
  if (starts.length !== 1 || end < 0 || text.indexOf(MANAGED_END, end + 1) >= 0 || end < starts[0]!.index!) return null;
  return [starts[0]!.index!, end + MANAGED_END.length];
}
/**
 * Refreshes Crewbie's block inside a charter a human edited and keeps every other line as they wrote it,
 * with the frontmatter name (and model, when both declare one) kept in step. Null when the markers are gone.
 */
export function mergeManagedBlock(current: string, generated: string): string | null {
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const text = current.replace(/\r\n/g, "\n");
  const mine = managedBlock(text), fresh = managedBlock(generated);
  if (!mine || !fresh) return null;
  let merged = text.slice(0, mine[0]) + generated.slice(fresh[0], fresh[1]) + text.slice(mine[1]);
  const header = /^---\n([\s\S]*?)\n---\n/.exec(merged), source = /^---\n([\s\S]*?)\n---\n/.exec(generated);
  if (header && source) {
    const document = parseDocument(header[1]!), wanted = parseDocument(source[1]!);
    if (!document.errors.length && isMap(document.contents) && !wanted.errors.length) {
      document.set("name", wanted.get("name"));
      if (document.has("model") && wanted.has("model")) document.set("model", wanted.get("model"));
      merged = `---\n${document.toString()}---\n${merged.slice(header[0].length)}`;
    }
  }
  return merged.replace(/\n/g, eol);
}