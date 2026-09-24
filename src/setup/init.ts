import { createInterface } from "node:readline/promises";
import { json, optionalText, readJson, record, safePath, string, textHash, writeAtomic } from "../core.js";
import { modelProfile, parseConfig } from "../config.js";
import type { GitHubApi } from "../tracking/github.js";
import { requireApprover } from "../tracking/github.js";
import { ensureLabels, setupLabels } from "../tracking/issues.js";
import { assess } from "./assessment.js";
import { applyInstallation, installation, setupConfiguration } from "./install.js";
import { proposeSetup, selectGuidance, type Analyze } from "./onboarding.js";
import { explicitModel, listCopilotModels, type ModelChoice } from "./copilot.js";
import { describeInstallationFile, renderInstallationPreview, renderSetupMarkdown, setupReportPath } from "./review.js";

interface InitOptions {
  proposal?: string; out?: string; apply?: boolean; update?: boolean;
  model?: string; repo?: string; approver?: string[]; description?: string;
  guidance?: string; "assessment-only"?: boolean; "skip-labels"?: boolean;
  json?: boolean;
  "model-policy"?: string; "specialist-model"?: string; "model-profile"?: string;
}
interface InitIO {
  client: () => GitHubApi;
  analyze?: Analyze;
  listModels?: () => Promise<ModelChoice[]>;
  ask?: (question: string) => Promise<string>;
  report?: (text: string) => void;
}

export async function installSetup(root: string, value: unknown, options: { apply: boolean; guidance: "apply" | "skip"; skipLabels: boolean; json?: boolean }, client?: GitHubApi): Promise<string> {
  const raw = record(value, "setup proposal");
  if (raw.status === "clarification") throw new Error("Answer the setup questions and rerun init before creating a team.");
  const config = setupConfiguration(raw);
  const existingConstitution = config.constitution && await optionalText(await safePath(root, config.constitution)) !== null ? config.constitution : null;
  const proposal = options.guidance === "apply" ? { ...raw, config } : {
    ...raw, instructions: [], constitutionText: null,
    config: { ...config, constitution: raw.constitutionText ? existingConstitution : config.constitution },
  };
  const changes = await installation(root, proposal);
  const labels = options.skipLabels ? [] : setupLabels(config);
  if (!options.apply) return options.json ? json({ files: changes.map(describeInstallationFile), labels, repository: config.repository }) : renderInstallationPreview(changes, labels, config.repository);
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
  return `Applied ${changes.length} reviewed file changes (${changes.filter((change) => change.before !== null && change.after !== null).length} existing files updated, ${changes.filter((change) => change.after === null).length} original agents archived). ${options.skipLabels ? "GitHub labels explicitly skipped." : "All Crewbie workflow and specialist labels are available."}`;
}

export async function initCommand(root: string, options: InitOptions, io: InitIO): Promise<void> {
  const report = io.report ?? console.log;
  const terminal = !io.ask && process.stdin.isTTY && process.stdout.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = io.ask ?? (terminal ? async (question: string) => terminal.question(`${question}\n> `) : undefined);
  try {
    if (options.guidance !== undefined && !["apply", "skip"].includes(options.guidance)) throw new Error("--guidance must be apply or skip.");
    if (options["model-policy"] !== undefined && !["fixed", "cost-aware"].includes(options["model-policy"])) throw new Error("--model-policy must be fixed or cost-aware.");
    if (options["model-profile"] !== undefined) modelProfile(options["model-profile"]);
    if (options["assessment-only"] && (options.proposal || options.apply || options.guidance)) throw new Error("--assessment-only cannot apply setup or guidance.");
    if (options.proposal) {
      const proposal = record(await readJson(await safePath(root, options.proposal)), "setup proposal");
      if (proposal.review && !options.json) {
        const review = record(proposal.review, "setup review");
        report(string(review.summary, "assessment summary"));
      }
      const markdown = setupReportPath(options.proposal);
      await writeAtomic(root, markdown, renderSetupMarkdown(proposal));
      if (!options.json) report(`Readable assessment: ${markdown}`);
      const hasGuidance = (Array.isArray(proposal.instructions) && proposal.instructions.length > 0) || proposal.constitutionText;
      if (!hasGuidance && !options.json) report("No existing guidance edits proposed; recommendations in the assessment are advisory only.");
      let guidance = options.guidance;
      if (options.apply && hasGuidance && !guidance && ask) guidance = (await ask("Apply proposed guidance/constitution too? Enter apply or skip (team only).")).trim();
      if (options.apply && hasGuidance && !guidance) throw new Error("Choose --guidance apply or --guidance skip; guidance changes need a separate decision.");
      if (guidance && !["apply", "skip"].includes(guidance)) throw new Error("Choose apply or skip for guidance.");
      report(await installSetup(root, proposal, {
        apply: options.apply === true, guidance: guidance === "skip" ? "skip" : "apply", skipLabels: options["skip-labels"] === true, json: options.json === true,
      }, options.apply && !options["skip-labels"] ? io.client() : undefined));
      return;
    }
    if (options.apply) throw new Error("Use --proposal with --apply; review the generated setup before noninteractive installation.");
    const assessment = await assess(root);
    if (options.update && assessment.configBeforeHash === null) throw new Error("No installed crew to reassess. Run init without --update first.");
    if (options.repo !== undefined) assessment.config.repository = options.repo;
    if (options.approver !== undefined) assessment.config.approvers = options.approver;
    if (options["model-profile"] !== undefined) assessment.config.modelProfile = modelProfile(options["model-profile"]);
    assessment.config = parseConfig(assessment.config);
    if (options["assessment-only"]) {
      if (options.out) await writeAtomic(root, options.out, json(assessment));
      report(json(assessment));
      return;
    }
    let model = options.model ?? "";
    let catalog: ModelChoice[] | undefined;
    if (!model && ask) {
      const models = await (io.listModels ?? listCopilotModels)();
      catalog = models;
      if (!models.length) throw new Error("No available models were returned. Check Copilot access before onboarding.");
      report("Choose a Copilot model for the assessment (specialist choices are reviewed separately):\n" + models.map((choice, index) =>
        `${index + 1}. ${choice.name} (${choice.id})${choice.multiplier === undefined ? "" : ` - ${choice.multiplier}x billing multiplier`}`).join("\n"));
      while (!model) {
        const selected = (await ask("Enter a model number or an exact model ID from the list (q to cancel).")).trim();
        if (selected.toLowerCase() === "q") throw new Error("Setup cancelled before analysis. No files or labels were changed.");
        const choice = /^\d+$/.test(selected) ? models[Number(selected) - 1] : models.find((item) => item.id === selected);
        if (choice) model = choice.id;
        else report("Invalid choice. Select one of the listed models.");
      }
    }
    if (!model) throw new Error("Use --model MODEL for LLM onboarding, or --assessment-only for offline inventory.");
    const dynamic = options["model-policy"] !== "fixed" && !options["specialist-model"];
    if (dynamic) catalog ??= await (io.listModels ?? listCopilotModels)();
    if (dynamic && !catalog?.length) throw new Error("No available models were returned for specialist selection.");
    if (options["specialist-model"]) explicitModel(options["specialist-model"]);
    let description = options.description ?? "";
    if (!description && assessment.inventory.mode === "greenfield" && ask) {
      description = await ask("Describe the greenfield project: purpose, users, main behavior, platform/stack (or freedom to choose), and constraints.");
    }
    if (!ask && !description.trim() && assessment.inventory.mode === "greenfield" && !assessment.inventory.files.some((file) => /(?:README|requirements|spec|prd)/i.test(file.path))) {
      throw new Error("Greenfield setup needs a project description. Rerun init --description \"purpose, users, behavior, platform and constraints\"; no team was generated.");
    }
    report("I'm analysing your codebase, existing agents and project guidance to put your crew together. This may take a few minutes and consume AI credits. I'll show you the recommendations before changing anything; no project scripts or MCP servers are run.");
    const proposal = await proposeSetup(assessment, description, model, {
      ...(io.analyze ? { analyze: io.analyze } : {}), ...(ask ? { ask } : {}), report,
      models: dynamic ? catalog ?? [] : [], specialistModel: options["specialist-model"] ?? model,
    });
    const output = options.out ?? "crewbie-setup.json";
    const markdown = setupReportPath(output);
    await writeAtomic(root, output, json(proposal));
    await writeAtomic(root, markdown, renderSetupMarkdown(proposal));
    report(`Readable assessment: ${markdown}\nEditable setup: ${output}`);
    if (proposal.status === "clarification") {
      throw new Error(`Setup needs clarification; questions saved in ${output}. Rerun init with an expanded --description. No team was installed.`);
    }
    if (!ask) {
      report(`Assessment and tailored team saved to ${output}. Review, then run init --proposal ${output} --apply --guidance apply|skip. GitHub labels are created on apply.`);
      return;
    }
    const choice = (await ask(`Install this proposal? Enter team (adopt/create agents; skip guidance edits), all (also apply ${proposal.instructions.length} guidance edits${proposal.constitutionText ? " and the proposed constitution" : ""}), or save (no installation).`)).trim().toLowerCase();
    if (!["team", "all", "save"].includes(choice)) throw new Error(`Unknown choice; proposal saved to ${output}. Nothing installed.`);
    if (choice === "save") return;
    if (!proposal.config.planning?.enabled) {
      let planning: string;
      do { planning = (await ask(`Enable hosted planning using ${model}? Enter yes or no. New installations default to paid implementation after your exact-head approval and merge; existing explicit execution opt-outs are preserved.`)).trim().toLowerCase(); }
      while (!["yes", "no"].includes(planning));
      if (planning === "yes") proposal.config.planning = { enabled: true, model,
        executeOnMerge: assessment.configBeforeHash === null ? true : proposal.config.planning?.executeOnMerge === true };
      else report("Hosted planning stays disabled. The ready-for-planning label will not create a plan.");
    }
    if (!proposal.config.repository && !options["skip-labels"]) proposal.config.repository = (await ask("GitHub repository (owner/name) for workflow labels?")).trim();
    if (!proposal.config.approvers.length && !options["skip-labels"]) {
      proposal.config.approvers = (await ask("Human GitHub approver logins, comma-separated?")).split(",").map((login) => login.trim()).filter(Boolean);
    }
    const selected = selectGuidance(proposal, choice === "all");
    await writeAtomic(root, output, json(proposal));
    await writeAtomic(root, markdown, renderSetupMarkdown(proposal, await installation(root, selected))
      + `\n## Installation choice\n\n${choice === "all" ? "Team plus the concrete guidance edits listed above." : "Team only. Proposed guidance edits remain in the saved proposal but will not be applied in this run."}\n`);
    report(await installSetup(root, selected, { apply: false, guidance: "apply", skipLabels: options["skip-labels"] === true }));
    if ((await ask("Apply exactly these files and labels? Enter yes to confirm.")).trim().toLowerCase() !== "yes") return;
    report(await installSetup(root, selected, { apply: true, guidance: "apply", skipLabels: options["skip-labels"] === true }, options["skip-labels"] ? undefined : io.client()));
    proposal.configBeforeHash = textHash(json(selected.config));
    await writeAtomic(root, output, json(proposal));
  } finally {
    terminal?.close();
  }
}
