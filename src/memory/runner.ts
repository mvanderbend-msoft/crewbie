import { unlink } from "node:fs/promises";
import { errorCode, json, optionalText, readJson, record, safePath, textHash, writeAtomic } from "../core.js";
import type { Config } from "../config.js";
import type { GitHubApi } from "../tracking/github.js";
import { collectRecords, evidenceId, parseRecords } from "../reporting/records.js";
import { memoryContext, relevantTopics, type ContextFile } from "./context.js";
import { maintenancePrompt, parseProposal, publishProposal, seenEvidence, selectEvidence, validateProposal } from "./improvement.js";
import { readState, saveState } from "./state.js";

const INPUT = ".crewbie-maintenance-input.json";
const OUTPUT = ".crewbie-maintenance-output.txt";
const PROMPT = ".crewbie-maintenance-prompt.txt";
export async function prepareMaintenance(root: string, client: GitHubApi, config: Config): Promise<number> {
  for (const path of [INPUT, OUTPUT, PROMPT]) {
    try { await unlink(await safePath(root, path)); }
    catch (error) { if (!errorCode(error, "ENOENT")) throw error; }
  }
  if (!config.nightly.enabled) return 0;
  const state = await readState(client, config.repository);
  const seen = await seenEvidence(client, config.repository);
  for (const entry of Object.values(state.processed)) seen.add(entry.fingerprint);
  const evidence = selectEvidence(await collectRecords(client, config), seen, config.nightly.maxRecords);
  if (!evidence.length) return 0;
  const byPath = new Map<string, ContextFile>();
  const affectedRoles = ["improver", ...config.roles.filter((role) => evidence.some((run) => run.specialist === role.id)).map((role) => role.id)];
  const query = evidence.map((run) => run.summary).join("\n");
  for (const role of affectedRoles) {
    const base = await memoryContext(root, config, role);
    const index = base.filter((file) => file.path.endsWith("/index.md") || file.path === ".crewbie/decisions.md").map((file) => file.content).join("\n");
    for (const file of await memoryContext(root, config, role, relevantTopics(index, query))) byPath.set(file.path, file);
    const path = `.github/agents/crewbie-${role}.agent.md`;
    const content = await optionalText(await safePath(root, path));
    if (content === null) throw new Error(`Missing charter ${path}.`);
    byPath.set(path, { path, content, sha256: textHash(content) });
  }
  const files = [...byPath.values()];
  const prompt = maintenancePrompt(config, evidence, files);
  if (prompt.length > 100_000) throw new Error("Maintenance context exceeds 100 KB. Narrow the evidence batch; no input was silently truncated.");
  await writeAtomic(root, INPUT, json({ schemaVersion: 1, evidence, stateRevision: state.revision }));
  await writeAtomic(root, PROMPT, prompt);
  return evidence.length;
}
export async function applyMaintenance(root: string, client: GitHubApi, config: Config): Promise<string> {
  if (!config.nightly.enabled) return "Nightly improvement is disabled.";
  const inputPath = await safePath(root, INPUT);
  if (await optionalText(inputPath) === null) return "No new evidence; no analysis or proposal needed.";
  const input = record(await readJson(inputPath), "maintenance input");
  const evidence = parseRecords(input.evidence);
  const output = await optionalText(await safePath(root, OUTPUT));
  if (!output) throw new Error("Maintenance analysis did not produce output.");
  const body = output.trim().replace(/^```json\s*\n([\s\S]*?)\n```$/, "$1");
  const proposal = parseProposal(JSON.parse(body) as unknown);
  await validateProposal(root, config, proposal, evidence);
  const state = await readState(client, config.repository);
  if (state.revision !== input.stateRevision) throw new Error("Maintenance state changed during analysis. Prepare again.");
  const url = await publishProposal(client, config, proposal, evidence);
  for (const run of evidence) {
    state.processed = { ...state.processed, [run.id]: { fingerprint: evidenceId(run), outcome: url ? `Proposed: ${url}` : "Reviewed; no justified change." } };
  }
  await saveState(client, config.repository, state);
  return url ? `Proposal ready for human review: ${url}` : "Evidence reviewed; no justified change. Cursor saved without opening a PR.";
}
