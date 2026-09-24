import { parseDocument, isMap, isSeq } from "yaml";
import { agentArchivePath, limitsFor, type Config, type Role } from "../config.js";
import { optionalText, safePath, words } from "../core.js";
import { profile } from "./templates.js";

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
  const body = header ? text.slice(header[0].length) : text;
  const result = `---\n${document.toString()}---\n${body}\n\n${generated.replace(/^---\n[\s\S]*?\n---\n# [^\n]*\n/, "## Crewbie integration\n")}`;
  const limit = limitsFor(config).charter;
  if (words(result) > limit) throw new Error(`Adopted ${role.id} charter needs ${words(result)} words; the limit remains ${limit}. Please shorten the original ${role.sourceAgent} and rerun init, leaving room for Crewbie integration. No original instructions were truncated or archived.`);
  return result;
}
