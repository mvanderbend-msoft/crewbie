import { createInterface } from "node:readline/promises";
import { json, optionalText, readJson, record, safePath, string, writeAtomic } from "../core.js";
import { parseConfig } from "../config.js";
import type { GitHubApi } from "../tracking/github.js";
import { requireApprover } from "../tracking/github.js";
import { ensureLabels, setupLabels } from "../tracking/issues.js";
import { assess } from "./assessment.js";
import { applyInstallation, installation } from "./install.js";
import { proposeSetup, selectGuidance, type Analyze } from "./onboarding.js";

interface InitOptions {
  proposal?: string; out?: string; apply?: boolean; update?: boolean;
  model?: string; repo?: string; approver?: string[]; description?: string;
  guidance?: string; "assessment-only"?: boolean; "skip-labels"?: boolean;
}
interface InitIO {
  client: () => GitHubApi;
  analyze?: Analyze;
  ask?: (question: string) => Promise<string>;
  report?: (text: string) => void;
}

export async function installSetup(root: string, value: unknown, options: { apply: boolean; guidance: "apply" | "skip"; skipLabels: boolean }, client?: GitHubApi): Promise<string> {
  const raw = record(value, "setup proposal");
  if (raw.status === "clarification") throw new Error("Answer the setup questions and rerun init before creating a team.");
  const config = parseConfig(raw.config);
  const existingConstitution = config.constitution && await optionalText(await safePath(root, config.constitution)) !== null ? config.constitution : null;
  const proposal = options.guidance === "apply" ? raw : {
    ...raw, instructions: [], constitutionText: null,
    config: { ...config, constitution: raw.constitutionText ? existingConstitution : config.constitution },
  };
  const changes = await installation(root, proposal);
  const labels = options.skipLabels ? [] : setupLabels(config);
  if (!options.apply) return json({ files: changes, labels, repository: config.repository }) + "Preview only. Add --apply after reviewing files and GitHub label creation.";
  if (!options.skipLabels) {
    if (!config.repository || !config.approvers.length) throw new Error("Set repository and human approvers before creating GitHub labels, or explicitly use --skip-labels for offline setup.");
    if (!client) throw new Error("GitHub authentication is required to create setup labels.");
    await requireApprover(client, config.approvers);
  }
  await applyInstallation(root, changes);
  if (!options.skipLabels && client) {
    try { await ensureLabels(client, config); }
    catch (error) {
      throw new Error(`Local setup was applied, but GitHub labels are incomplete. Rerun the same init --proposal ... --apply command; matching labels are preserved. ${error instanceof Error ? error.message : "Label creation failed."}`);
    }
  }
  return `Applied ${changes.length} reviewed file changes. ${options.skipLabels ? "GitHub labels explicitly skipped." : "All Crewbie workflow and specialist labels are available."}`;
}

export async function initCommand(root: string, options: InitOptions, io: InitIO): Promise<void> {
  const report = io.report ?? console.log;
  const terminal = !io.ask && process.stdin.isTTY && process.stdout.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = io.ask ?? (terminal ? async (question: string) => terminal.question(`${question}\n> `) : undefined);
  try {
    if (options.guidance !== undefined && !["apply", "skip"].includes(options.guidance)) throw new Error("--guidance must be apply or skip.");
    if (options["assessment-only"] && (options.proposal || options.apply || options.guidance)) throw new Error("--assessment-only cannot apply setup or guidance.");
    if (options.proposal) {
      const proposal = record(await readJson(await safePath(root, options.proposal)), "setup proposal");
      if (proposal.review) {
        const review = record(proposal.review, "setup review");
        report(string(review.summary, "assessment summary"));
        report(json(review.findings));
      }
      const hasGuidance = (Array.isArray(proposal.instructions) && proposal.instructions.length > 0) || proposal.constitutionText;
      let guidance = options.guidance;
      if (options.apply && hasGuidance && !guidance && ask) guidance = (await ask("Apply proposed guidance/constitution too? Enter apply or skip (team only).")).trim();
      if (options.apply && hasGuidance && !guidance) throw new Error("Choose --guidance apply or --guidance skip; guidance changes need a separate decision.");
      if (guidance && !["apply", "skip"].includes(guidance)) throw new Error("Choose apply or skip for guidance.");
      report(await installSetup(root, proposal, {
        apply: options.apply === true, guidance: guidance === "skip" ? "skip" : "apply", skipLabels: options["skip-labels"] === true,
      }, options.apply && !options["skip-labels"] ? io.client() : undefined));
      return;
    }
    if (options.apply) throw new Error("Use --proposal with --apply; review the generated setup before noninteractive installation.");
    const assessment = await assess(root);
    if (options.update && assessment.configBeforeHash === null) throw new Error("No installed crew to reassess. Run init without --update first.");
    if (options.repo !== undefined) assessment.config.repository = options.repo;
    if (options.approver !== undefined) assessment.config.approvers = options.approver;
    assessment.config = parseConfig(assessment.config);
    if (options["assessment-only"]) {
      if (options.out) await writeAtomic(root, options.out, json(assessment));
      report(json(assessment));
      return;
    }
    const model = options.model ?? (ask ? (await ask("Which explicit Copilot model should assess this project and run new specialists?")).trim() : "");
    if (!model) throw new Error("Use --model MODEL for LLM onboarding, or --assessment-only for offline inventory.");
    let description = options.description ?? "";
    if (!description && assessment.inventory.mode === "greenfield" && ask) {
      description = await ask("Describe the greenfield project: purpose, users, main behavior, platform/stack (or freedom to choose), and constraints.");
    }
    if (!ask && !description.trim() && assessment.inventory.mode === "greenfield" && !assessment.inventory.files.some((file) => /(?:README|requirements|spec|prd)/i.test(file.path))) {
      throw new Error("Greenfield setup needs a project description. Rerun init --description \"purpose, users, behavior, platform and constraints\"; no team was generated.");
    }
    report("Assessing repository-visible guidance, MCP configuration and agents with Copilot. This may consume AI credits; no project scripts or MCP servers are executed.");
    const proposal = await proposeSetup(assessment, description, model, {
      ...(io.analyze ? { analyze: io.analyze } : {}), ...(ask ? { ask } : {}), report,
    });
    const output = options.out ?? "crewbie-setup.json";
    await writeAtomic(root, output, json(proposal));
    if (proposal.status === "clarification") {
      throw new Error(`Setup needs clarification; questions saved in ${output}. Rerun init with an expanded --description. No team was installed.`);
    }
    if (!ask) {
      report(`Assessment and tailored team saved to ${output}. Review, then run init --proposal ${output} --apply --guidance apply|skip. GitHub labels are created on apply.`);
      return;
    }
    const choice = (await ask("Install this proposal? Enter team (skip guidance), all (include guidance/constitution), or save (no installation).")).trim().toLowerCase();
    if (!["team", "all", "save"].includes(choice)) throw new Error(`Unknown choice; proposal saved to ${output}. Nothing installed.`);
    if (choice === "save") return;
    if (!proposal.config.repository && !options["skip-labels"]) proposal.config.repository = (await ask("GitHub repository (owner/name) for workflow labels?")).trim();
    if (!proposal.config.approvers.length && !options["skip-labels"]) {
      proposal.config.approvers = (await ask("Human GitHub approver logins, comma-separated?")).split(",").map((login) => login.trim()).filter(Boolean);
    }
    const selected = selectGuidance(proposal, choice === "all");
    await writeAtomic(root, output, json(selected));
    report(await installSetup(root, selected, { apply: false, guidance: "apply", skipLabels: options["skip-labels"] === true }));
    if ((await ask("Apply exactly these files and labels? Enter yes to confirm.")).trim().toLowerCase() !== "yes") return;
    report(await installSetup(root, selected, { apply: true, guidance: "apply", skipLabels: options["skip-labels"] === true }, options["skip-labels"] ? undefined : io.client()));
  } finally {
    terminal?.close();
  }
}
