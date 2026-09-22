import { readdir } from "node:fs/promises";
import { bounded, errorCode, hash, json, matchesTextHash, optionalText, readJson, record, safePath, string, textHash, writeAtomic } from "../core.js";
import { limitsFor, parseConfig } from "../config.js";
import { profile, PR_TEMPLATE, SHARED_INSTRUCTIONS, SKILL, workflows } from "./templates.js";

async function hasPrTemplate(root: string): Promise<boolean> {
  for (const directory of ["", ".github", "docs"]) {
    try {
      const names = await readdir(directory ? await safePath(root, directory) : root);
      if (names.some((name) => /^pull_request_template(?:\.[^.]+)?$/i.test(name))) return true;
    } catch (error) {
      if (!errorCode(error, "ENOENT")) throw error;
    }
  }
  return false;
}

export interface FileChange { path: string; before: string | null; after: string }
export async function installation(root: string, proposal: unknown): Promise<FileChange[]> {
  const data = record(proposal, "setup proposal");
  const config = parseConfig(data.config);
  const limits = limitsFor(config);
  bounded(SHARED_INSTRUCTIONS, limits.constitution, "Shared working rules");
  const adopted: Record<string, string> = {};
  const files: Record<string, string> = { ".crewbie/config.json": json(config), ".crewbie/instructions.md": SHARED_INSTRUCTIONS, ".github/skills/crewbie/SKILL.md": SKILL, ...workflows(config.nightly.enabled) };
  if (data.constitutionText !== null && data.constitutionText !== undefined) {
    const content = string(data.constitutionText, "constitution text");
    if (!config.constitution) throw new Error("Select a constitution path before proposing its contents.");
    bounded(content, limits.constitution, "Constitution");
    files[config.constitution] = content.endsWith("\n") ? content : content + "\n";
  }
  if (data.adopt !== undefined) {
    for (const [path, digest] of Object.entries(record(data.adopt, "approved adoption hashes"))) {
      adopted[path] = string(digest, "adoption hash");
    }
  }
  if (data.instructions !== undefined) {
    if (!Array.isArray(data.instructions)) throw new Error("instructions must be a list of reviewed file changes.");
    for (const raw of data.instructions) {
      const instruction = record(raw, "instruction proposal");
      const path = string(instruction.path, "instruction path");
      if (path !== "AGENTS.md" && path !== ".github/copilot-instructions.md" && !/^\.github\/instructions\/[a-z0-9._-]+\.instructions\.md$/.test(path)) {
        throw new Error(`Unsupported instruction path: ${path}`);
      }
      const content = string(instruction.content, "instruction content");
      bounded(content, limits.constitution, path);
      files[path] = content;
      if (instruction.beforeHash !== null) adopted[path] = string(instruction.beforeHash, "instruction beforeHash");
    }
  }
  const allRoles = [
    ...config.roles,
    { id: "coordinator", purpose: "Clarify work, propose ownership and dependencies, and route only human-approved tasks.", model: "" },
    { id: "improver", purpose: "Propose small, evidence-linked improvements to managed guidance and memory for human review.", model: "" },
  ];
  for (const role of allRoles) {
    const charter = profile(role, config);
    bounded(charter, limits.charter, `${role.id} charter`);
    files[`.github/agents/crewbie-${role.id}.agent.md`] = charter;
    for (const tier of ["hot", "index"]) {
      const path = `.crewbie/team/${role.id}/${tier}.md`;
      if (await optionalText(await safePath(root, path)) === null) {
        files[path] = tier === "hot" ? `# ${role.id}: current lessons\n\nAdd only approved, durable lessons with source links.\n` : `# ${role.id}: memory index\n\nLink relevant cold topics and archived decisions here. Read detail only when needed.\n`;
      }
    }
  }
  const decisions = ".crewbie/decisions.md";
  if (await optionalText(await safePath(root, decisions)) === null) files[decisions] = "# Shared decisions\n\nRecord approved choices, short reasons, scope and evidence links. Link existing ADRs rather than copying them.\n";
  let owned: Record<string, unknown> = {};
  const manifestPath = await safePath(root, ".crewbie/managed.json");
  if (await optionalText(manifestPath) !== null) owned = record(await readJson(manifestPath), "managed file manifest");
  const templatePath = ".github/PULL_REQUEST_TEMPLATE.md";
  if (owned[templatePath] !== undefined || !(await hasPrTemplate(root))) files[templatePath] = PR_TEMPLATE;
  const changes: FileChange[] = [];
  for (const [path, after] of Object.entries(files)) {
    const before = await optionalText(await safePath(root, path));
    if (before !== null && textHash(before) === textHash(after)) continue;
    if (before !== null && !matchesTextHash(before, owned[path]) && adopted[path] !== hash(before)) {
      throw new Error(`Preserving user-owned or edited file: ${path}. Reconcile it manually before installation.`);
    }
    changes.push({ path, before, after });
  }
  return changes;
}
export async function applyInstallation(root: string, changes: FileChange[]): Promise<void> {
  const manifest = await optionalText(await safePath(root, ".crewbie/managed.json"));
  const hashes = manifest === null ? {} : record(JSON.parse(manifest) as unknown, "managed file manifest");
  for (const change of changes) {
    if (await optionalText(await safePath(root, change.path)) !== change.before) throw new Error(`${change.path} changed since preview. Preview again.`);
  }
  for (const change of changes) {
    await writeAtomic(root, change.path, change.after);
    hashes[change.path] = textHash(change.after);
    await writeAtomic(root, ".crewbie/managed.json", json(hashes));
  }
}
