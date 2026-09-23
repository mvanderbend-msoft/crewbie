import { readJson, record, string, strings, slug, integer, safePath } from "./core.js";

export interface Role { id: string; purpose: string; model: string; checks?: string[]; nonNegotiables?: string[]; contextPaths?: string[] }
export const PLANNING_LABEL = "crewbie:ready-for-planning";
export const DEFAULT_LIMITS = { spec: 600, charter: 400, hot: 600, index: 400, decisions: 400, constitution: 600, topic: 1500, pr: 250 };
export type WordLimits = typeof DEFAULT_LIMITS;
export interface Config {
  schemaVersion: 1;
  repository: string;
  approvers: string[];
  roles: Role[];
  constitution: string | null;
  maxActive: number;
  nightly: { enabled: boolean; maxRecords: number; allowedPaths: string[] };
  ado: { organization: string; project: string; workItemType: string } | null;
  limits?: WordLimits;
  planning?: { enabled: boolean; model: string; executeOnMerge?: boolean };
}
export function limitsFor(config?: Config): WordLimits { return config?.limits ?? DEFAULT_LIMITS; }
export function isRoleContextPath(path: string): boolean {
  return /^(?:[A-Za-z0-9._ -]+\/)*[A-Za-z0-9._ -]+\.md$/i.test(path)
    && !path.includes("..") && !path.toLowerCase().startsWith(".git/");
}
export function parseConfig(value: unknown): Config {
  const data = record(value, "Configuration");
  if (data.schemaVersion !== 1) throw new Error("Unsupported configuration version.");
  const repository = string(data.repository, "repository", true);
  if (repository && !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("repository must be owner/name.");
  const approvers = strings(data.approvers, "approvers");
  if (approvers.some((login) => !/^[A-Za-z0-9-]+$/.test(login))) throw new Error("Approvers must be GitHub user logins.");
  if (!Array.isArray(data.roles) || !data.roles.length) throw new Error("Define at least one role.");
  const roles = data.roles.map((value): Role => {
    const role = record(value, "role");
    const result = { id: slug(role.id, "role id"), purpose: string(role.purpose, "role purpose"), model: string(role.model, "role model", true) };
    if (result.model.trim().toLowerCase() === "auto") throw new Error("Choose an explicit approved model, not auto.");
    if (["coordinator", "improver"].includes(result.id)) throw new Error(`${result.id} is reserved for a framework role.`);
    const guidance: Pick<Role, "checks" | "nonNegotiables" | "contextPaths"> = {};
    for (const key of ["checks", "nonNegotiables", "contextPaths"] as const) {
      if (role[key] === undefined) continue;
      const entries = strings(role[key], `role ${key}`);
      if (entries.length > 10 || entries.some((entry) => !entry.trim())) throw new Error(`Role ${key} needs at most ten nonempty entries.`);
      guidance[key] = entries;
    }
    const invalidPath = guidance.contextPaths?.find((path) => !isRoleContextPath(path));
    if (invalidPath !== undefined) {
      throw new Error(`Role ${result.id} contextPaths contains ${JSON.stringify(invalidPath)}; use repository-relative Markdown paths.`);
    }
    return { ...result, ...guidance };
  });
  if (new Set(roles.map((role) => role.id)).size !== roles.length) throw new Error("Role IDs must be unique.");
  const nightly = record(data.nightly, "nightly");
  if (typeof nightly.enabled !== "boolean") throw new Error("nightly.enabled must be true or false.");
  const allowedPaths = strings(nightly.allowedPaths, "nightly.allowedPaths");
  for (const path of allowedPaths) {
    const instruction = path === "AGENTS.md" || path === ".github/copilot-instructions.md" || /^\.github\/instructions\/[a-z0-9._-]+\.instructions\.md$/.test(path);
    const constitutionPath = typeof data.constitution === "string" && path === data.constitution && path.endsWith(".md");
    if ((!/^(?:\.crewbie\/(?:team|decisions)\/|\.crewbie\/(?:decisions|constitution|instructions)\.md$|\.github\/agents\/crewbie-[a-z0-9-]+\.agent\.md$)/.test(path) && !instruction && !constitutionPath) || path.includes("..") || path.includes("\\") || path.startsWith("/") || path.includes(":")) {
      throw new Error(`Nightly path is not a supported managed memory/profile path: ${path}`);
    }
  }
  const constitution = data.constitution === null ? null : string(data.constitution, "constitution");
  if (constitution && !constitution.endsWith(".md")) throw new Error("The constitution must reference a Markdown document.");
  const adoData = data.ado === null ? null : record(data.ado, "ado");
  const ado = adoData === null ? null : {
    organization: string(adoData.organization, "ADO organization"),
    project: string(adoData.project, "ADO project"),
    workItemType: string(adoData.workItemType, "ADO work item type"),
  };
  if (ado && !/^[A-Za-z0-9-]+$/.test(ado.organization)) throw new Error("Use an ADO organization name, not a URL.");
  const rawLimits = data.limits === undefined ? {} : record(data.limits, "word limits");
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key, integer(rawLimits[key] ?? fallback, `${key} word limit`, 1, 10000)])) as WordLimits;
  let planning: Config["planning"];
  if (data.planning !== undefined) {
    const value = record(data.planning, "planning");
    if (typeof value.enabled !== "boolean") throw new Error("planning.enabled must be true or false.");
    const model = string(value.model, "planning.model", !value.enabled);
    if (model && (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model) || model.toLowerCase() === "auto")) throw new Error("Choose an explicit planning model identifier, not auto.");
    if (value.executeOnMerge !== undefined && typeof value.executeOnMerge !== "boolean") throw new Error("planning.executeOnMerge must be true or false.");
    if (value.executeOnMerge === true && !value.enabled) throw new Error("Enable planning before opting into execution on merge.");
    planning = { enabled: value.enabled, model, ...(value.executeOnMerge === undefined ? {} : { executeOnMerge: value.executeOnMerge }) };
  }
  return {
    schemaVersion: 1, repository, approvers, roles, constitution,
    maxActive: integer(data.maxActive, "maxActive", 1, 20),
    nightly: { enabled: nightly.enabled, maxRecords: integer(nightly.maxRecords, "maxRecords", 1, 100), allowedPaths },
    ado, limits, ...(planning ? { planning } : {}),
  };
}
export async function loadConfig(root: string): Promise<Config> {
  const config = parseConfig(await readJson(await safePath(root, ".crewbie/config.json")));
  if (config.constitution) await safePath(root, config.constitution);
  return config;
}
export function requireExecution(config: Config): void {
  if (!config.repository || !config.approvers.length) throw new Error("Configure a repository and human approvers before remote writes.");
  if (config.roles.some((role) => !role.model.trim())) throw new Error("Approve an explicit model for every specialist before execution.");
}
