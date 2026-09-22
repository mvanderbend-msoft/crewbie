import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Config, Role } from "../config.js";
import { assessInstructions, instructionFile, type InstructionQuality } from "./instruction-quality.js";

export interface Assessment {
  schemaVersion: 1;
  findings: { area: string; status: "ready" | "gap" | "unknown"; evidence: string[]; detail: string }[];
  questions: string[];
  config: Config;
  constitutionText: string | null;
  instructions: { path: string; content: string; beforeHash: string | null }[];
  instructionQuality: InstructionQuality;
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
  const roles: Role[] = [];
  if (paths.some((path) => /\.(tsx|jsx|vue|svelte)$/.test(path))) roles.push({ id: "frontend", purpose: "Implement and test the repository's user interface using its existing patterns.", model: "" });
  if (paths.some((path) => /(^|\/)(api|server|backend)\//.test(path))) roles.push({ id: "backend", purpose: "Implement and test server-side behavior without breaking existing consumers.", model: "" });
  if (!roles.length) roles.push({ id: "developer", purpose: "Make focused changes using the repository's existing conventions and relevant tests.", model: "" });
  roles.push(
    { id: "tester", purpose: "Design focused regression and boundary tests, preserve application behavior, and report actual outcomes and coverage gaps.", model: "" },
    { id: "reviewer", purpose: "Review changes against acceptance criteria for correctness and material risks, with evidence rather than unrelated rewrites.", model: "" },
  );
  const findings: Assessment["findings"] = [
    { area: "Instructions", status: guidance.length ? "unknown" : "gap", evidence: guidance.slice(0, 12), detail: guidance.length ? "Guidance exists; presence does not establish quality. Review the evidence-linked instruction signals and resolve policy conflicts." : "First check whether existing documentation is enough; propose agent-specific guidance only for useful missing context." },
    { area: "Build and tests", status: build.length ? "unknown" : "gap", evidence: [...build, ...tests.slice(0, 4), ...ci].slice(0, 12), detail: "File inspection does not prove commands work. Ask permission before running project scripts." },
    { area: "Code structure", status: "unknown", evidence: paths.filter((path) => /(^|\/)(src|app|lib)\//.test(path)).slice(0, 8), detail: "Read representative implementations to distinguish intentional patterns from legacy exceptions." },
    { area: "Decisions", status: decisions.length || existingConstitution ? "ready" : "gap", evidence: [...(existingConstitution ? [existingConstitution] : []), ...decisions].slice(0, 10), detail: "Reuse existing decisions. Observed code is evidence, not automatically approved policy." },
    { area: "Cloud execution", status: "unknown", evidence: ci.slice(0, 5), detail: "Run doctor with a selected repository and specialist. Account permissions and model support require separate verification." },
  ];
  const instructionQuality = await assessInstructions(root, paths);
  findings.push({
    area: "Instruction quality", status: instructionQuality.signals.length ? "gap" : "unknown",
    evidence: instructionQuality.signals.length ? [...new Set(instructionQuality.signals.map((signal) => `${signal.path}:${signal.line}`))].slice(0, 12) : instructionQuality.inspected.slice(0, 12),
    detail: instructionQuality.signals.length
      ? `${instructionQuality.signals.length + instructionQuality.signalsOmitted} advisory signals detected; showing ${instructionQuality.signals.length}. See instructionQuality for evidence, recommendations and study limitations. They do not block adoption or authorize rewrites.`
      : "No selected static warning was found. This is not a quality certification; review repository-specific value and the disclosed inspection coverage.",
  });
  return {
    schemaVersion: 1, findings, instructionQuality,
    questions: [
      "Which existing constraints are intentional, and which are legacy debt?",
      "Which checks and human approvals are required before merge?",
      "Which areas must agents leave unchanged?",
      "Which instruction-quality warnings reflect stale or redundant guidance, and which are justified policies to preserve?",
      "Approve the proposed team and explicit models; do not infer policy from file names.",
    ],
    config: {
      schemaVersion: 1, repository: "", approvers: [], roles, constitution: existingConstitution,
      maxActive: 2, nightly: {
        enabled: false, maxRecords: 20,
        allowedPaths: [
          ".crewbie/team/", ".crewbie/decisions/", ".crewbie/decisions.md", ".crewbie/instructions.md",
          ...[...roles.map((role) => role.id), "coordinator", "improver"].map((role) => `.github/agents/crewbie-${role}.agent.md`),
        ],
      }, ado: null,
    },
    constitutionText: null,
    instructions: [],
  };
}
