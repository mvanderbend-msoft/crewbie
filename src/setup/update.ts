import { agentArchivePath, loadConfig } from "../config.js";
import { GitHubError, hash, json, optionalText, readJson, record, safePath, string, textHash } from "../core.js";
import { requireWriter, type GitHubApi } from "../tracking/github.js";
import { applyInstallation, installation } from "./install.js";
import { copilotVersionCommand, copilotVersionVariable } from "./copilot-version.js";
import { PACKAGE_PIN, PACKAGE_VERSION } from "./package.js";
import { describeInstallationFile, renderInstallationPreview } from "./review.js";

export async function updateRepository(root: string, options: { apply?: boolean; offline?: boolean; json?: boolean }, client?: GitHubApi): Promise<string> {
  const config = await loadConfig(root);
  const configText = string(await optionalText(await safePath(root, ".crewbie/config.json")), "installed configuration");
  const managed = record(await readJson(await safePath(root, ".crewbie/managed.json")), "managed file manifest");
  const agentAdoptions = Object.fromEntries(config.roles.filter((role) => role.sourceAgent).map((role) => {
    const path = role.sourceAgent!;
    return [path, string(managed[agentArchivePath(path)], `managed archive fingerprint for ${path}`)];
  }));
  const conflicts: string[] = [], kept: string[] = [];
  const changes = await installation(root, {
    config, configBeforeHash: textHash(configText), constitutionText: null, instructions: [],
    agentAdoptions, adopt: { ".crewbie/config.json": hash(configText) },
  }, conflicts, kept);
  const variablePath = `/repos/${config.repository}/actions/variables/CREWBIE_PACKAGE`;
  let override: string | null = null;
  if (!options.offline && config.repository) {
    if (!client) throw new Error("Authenticate GitHub for update, or explicitly use --offline to leave repository variables unchecked.");
    try { override = string(record(await client.request("GET", variablePath), "package variable").value, "package override", true); }
    catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
  }
  const variableChange = override !== null && override !== PACKAGE_PIN ? { before: override, after: PACKAGE_PIN } : null;
  const copilotMissing = !options.offline && !!config.repository && config.planning?.enabled === true && !!client
    && await copilotVersionVariable(client, config.repository) === null;
  const copilotNote = copilotMissing ? ` Hosted planning fails until an approved Copilot CLI version is set: ${copilotVersionCommand(config.repository)}` : "";
  const preview = {
    version: PACKAGE_VERSION, files: changes.map(describeInstallationFile), conflicts, kept, packageVariable: variableChange,
    remoteChecked: !options.offline && !!config.repository, ...(copilotMissing ? { copilotVersionMissing: true } : {}),
  };
  if (!options.apply) return options.json ? json(preview) : [
    `Repository integration update using installed CLI ${PACKAGE_VERSION}. No AI assessment or model/policy changes.`,
    renderInstallationPreview(changes, [], config.repository, kept),
    conflicts.length ? `Edited workflows or colliding files (resolve before applying):\n${conflicts.join("\n")}` : "No conflicts; your edits to agents and instructions are kept.",
    variableChange ? `Actions CREWBIE_PACKAGE override will change from ${override} to ${PACKAGE_PIN}.`
      : options.offline ? "Offline: Actions variables were not checked; an old CREWBIE_PACKAGE override can still select an older runtime." : "No package-variable change needed.",
    ...(copilotMissing ? [copilotNote.trim()] : []),
    "Review, then repeat with --apply. Upgrade the CLI separately with npm.",
  ].join("\n");
  if (conflicts.length) throw new Error(`Update blocked; no changes applied. Preserve and reconcile these edited files, then preview again: ${conflicts.join(", ")}`);
  if (variableChange && client) {
    await requireWriter(client, config.repository);
    const fresh = record(await client.request("GET", variablePath), "current package variable");
    if (fresh.value !== override) throw new Error("CREWBIE_PACKAGE changed since preview; update again.");
  }
  await applyInstallation(root, changes);
  if (variableChange && client) {
    try { await client.request("PATCH", variablePath, { name: "CREWBIE_PACKAGE", value: PACKAGE_PIN }); }
    catch (error) {
      throw new Error(`Local integration updated, but CREWBIE_PACKAGE was not updated. Rerun update after resolving GitHub access. ${error instanceof Error ? error.message : "GitHub update failed."}`);
    }
  }
  return `Updated ${changes.length} repository files to CLI ${PACKAGE_VERSION}; existing policy, models and memory preserved. ${variableChange ? "CREWBIE_PACKAGE updated." : options.offline ? "Offline: remote package override remains unchecked." : "No package-variable change needed."}${copilotNote} Commit the reviewed file changes. No workflows or agents were started.`;
}
