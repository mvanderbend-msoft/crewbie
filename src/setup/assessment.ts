import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseConfig, type Config, type Role } from "../config.js";
import { optionalText, safePath, textHash } from "../core.js";
import { assessInstructions, instructionFile, type InstructionQuality } from "./instruction-quality.js";
import { assessTeam, type TeamAssessment } from "./team.js";
import { inventory, type Inventory } from "./inventory.js";

export interface Assessment {
  schemaVersion: 1;
  findings: { area: string; status: "ready" | "gap" | "unknown"; evidence: string[]; detail: string }[];
  questions: string[];
  config: Config;
  constitutionText: string | null;
  instructions: { path: string; content: string; beforeHash: string | null; reason?: string }[];
  instructionQuality: InstructionQuality;
  configBeforeHash: string | null;
  team: TeamAssessment;
  inventory: Inventory;
  installedRoles: Role[];
}
export async function assess(root: string): Promise<Assessment> {
  const absolute = await realpath(resolve(root));
  const gitRoot = await realpath(execFileSync("git", ["-C", absolute, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  if (relative(absolute, gitRoot) !== "") throw new Error("Initialize Crewbie at the repository root, not a nested directory.");
  const output = execFileSync("git", ["-C", absolute, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  const paths = [...new Set(output.split("\0").filter(Boolean))].sort();
  const guidance = paths.filter((path) => instructionFile(path) || /(^|\/)CONTRIBUTING\.md$/.test(path));
  const build = paths.filter((path) => /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|Makefile)$|\.(sln|csproj)$/.test(path));
  const tests = paths.filter((path) => /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\./.test(path));
  const ci = paths.filter((path) => path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path));
  const existingConstitution = paths.find((path) => /(^|\/)constitution\.md$/i.test(path)) ?? null;
  const decisions = paths.filter((path) => /(^|\/)(adr|adrs|decisions)(\/|\.md$)/i.test(path));
  const installedText = await optionalText(await safePath(root, ".crewbie/config.json"));
  const installed = installedText === null ? null : parseConfig(JSON.parse(installedText) as unknown);
  const team = await assessTeam(root, paths, installed?.roles ?? []);
  const roles = [
    ...(installed?.roles ?? []),
    ...team.suggestions.filter(({ role }) => !installed?.roles.some((existing) => existing.id === role.id)).map(({ role }) => role),
  ];
  const findings: Assessment["findings"] = [
    { area: "Instructions", status: guidance.length ? "unknown" : "gap", evidence: guidance.slice(0, 12), detail: guidance.length ? "Guidance exists; presence does not establish quality. Review the evidence-linked instruction signals and resolve policy conflicts." : "First check whether existing documentation is enough; propose agent-specific guidance only for useful missing context." },
    { area: "Build and tests", status: build.length ? "unknown" : "gap", evidence: [...build, ...tests.slice(0, 4), ...ci].slice(0, 12), detail: "File inspection does not prove commands work. Ask permission before running project scripts." },
    { area: "Code structure", status: "unknown", evidence: paths.filter((path) => /(^|\/)(src|app|lib)\//.test(path)).slice(0, 8), detail: "Read representative implementations to distinguish intentional patterns from legacy exceptions." },
    { area: "Decisions", status: decisions.length || existingConstitution ? "ready" : "gap", evidence: [...(existingConstitution ? [existingConstitution] : []), ...decisions].slice(0, 10), detail: "Reuse existing decisions. Observed code is evidence, not automatically approved policy." },
    { area: "Cloud execution", status: "unknown", evidence: ci.slice(0, 5), detail: "Run doctor with a selected repository and specialist. Account permissions and model support require separate verification." },
  ];
  const instructionQuality = await assessInstructions(root, paths);
  const context = await inventory(root, paths);
  findings.push(
    { area: "MCP servers", status: "unknown", evidence: context.mcp.map((file) => file.path), detail: "Inspect configured capabilities, overlap and missing integrations. Server connectivity and personal/global settings are not verified; credential values are withheld." },
    { area: "Custom agents", status: "unknown", evidence: context.files.filter((file) => file.kind === "agents").map((file) => file.path), detail: "Review existing responsibilities and reuse their guidance before proposing new specialists." },
  );
  findings.push({
    area: "Instruction quality", status: instructionQuality.signals.length ? "gap" : "unknown",
    evidence: instructionQuality.signals.length ? [...new Set(instructionQuality.signals.map((signal) => `${signal.path}:${signal.line}`))].slice(0, 12) : instructionQuality.inspected.slice(0, 12),
    detail: instructionQuality.signals.length
      ? `${instructionQuality.signals.length + instructionQuality.signalsOmitted} advisory signals detected; showing ${instructionQuality.signals.length}. See instructionQuality for evidence, recommendations and study limitations. They do not block adoption or authorize rewrites.`
      : "No selected static warning was found. This is not a quality certification; review repository-specific value and the disclosed inspection coverage.",
  });
  return {
    schemaVersion: 1, findings, instructionQuality, team, inventory: context, installedRoles: installed?.roles ?? [],
    configBeforeHash: installedText === null ? null : textHash(installedText),
    questions: [
      "Which existing constraints are intentional, and which are legacy debt?",
      "Which checks and human approvals are required before merge?",
      "Which areas must agents leave unchanged?",
      "Which instruction-quality warnings reflect stale or redundant guidance, and which are justified policies to preserve?",
      "Which expertise does the project and upcoming feature need? Review the team evidence; add custom specialists or split, specialize and retire existing roles only after reviewing their open work.",
      "Approve explicit models and domain checks for added roles. Existing models, policy and memory are preserved; discovery hints are not a fixed roster.",
      "Enable hosted planning from crewbie:ready-for-planning labels? Approve planning.model and the human approvers first; this authorizes planning, not implementation.",
      "Enable planning.executeOnMerge? Then a human approval of the exact planning head plus a human merge authorizes automatic paid execution; configure the supported assignment credential once.",
    ],
    config: installed ? { ...installed, roles } : {
      schemaVersion: 1, repository: "", approvers: [], roles, constitution: existingConstitution,
      maxActive: 2, nightly: {
        enabled: false, maxRecords: 20,
        allowedPaths: [
          ".crewbie/team/", ".crewbie/decisions/", ".crewbie/decisions.md", ".crewbie/instructions.md",
          ...[...roles.map((role) => role.id), "coordinator", "improver"].map((role) => `.github/agents/crewbie-${role}.agent.md`),
        ],
      }, ado: null, planning: { enabled: false, model: "", executeOnMerge: false },
    },
    constitutionText: null,
    instructions: [],
  };
}
