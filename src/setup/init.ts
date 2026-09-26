import { json, optionalText, readJson, record, safePath, string, textHash, writeAtomic } from "../core.js";
import { modelProfile, parseConfig } from "../config.js";
import type { GitHubApi } from "../tracking/github.js";
import { cloudAgentAccepts } from "../execution/controls.js";
import { requireWriter } from "../tracking/github.js";
import { ensureLabels, setupLabels } from "../tracking/issues.js";
import { assess } from "./assessment.js";
import { applyInstallation, installation, setupConfiguration } from "./install.js";
import { proposeSetup, selectGuidance, type Analyze } from "./onboarding.js";
import { explicitModel, listCopilotModels, type ModelChoice } from "./copilot.js";
import { describeInstallationFile, renderInstallationPreview, renderSetupMarkdown, setupReportPath } from "./review.js";
import { terminalPrompts, type SetupPrompts } from "./terminal.js";
import { COPILOT_VERSION_VARIABLE, copilotVersion as copilotVersionOf, copilotVersionCommand, copilotVersionVariable, setCopilotVersion } from "./copilot-version.js";
import { suggestedStartCommand } from "../execution/test-feature.js";

interface InitOptions {
  proposal?: string; out?: string; apply?: boolean; update?: boolean;
  model?: string; repo?: string; description?: string;
  guidance?: string; "assessment-only"?: boolean; "skip-labels"?: boolean;
  json?: boolean; "copilot-version"?: string;
  "model-policy"?: string; "specialist-model"?: string; "model-profile"?: string;
  start?: string;
}
interface InitIO {
  client: () => GitHubApi;
  analyze?: Analyze;
  listModels?: () => Promise<ModelChoice[]>;
  latestCopilotVersion?: () => Promise<string | undefined>;
  ask?: (question: string) => Promise<string>;
  select?: SetupPrompts["select"];
  confirm?: SetupPrompts["confirm"];
  report?: (text: string) => void;
}

async function planningVariable(client: GitHubApi, repository: string, version: string | undefined): Promise<string> {
  let existing: string | null;
  try {
    existing = await copilotVersionVariable(client, repository);
    if (existing) return `Hosted planning uses Copilot CLI ${existing} (${COPILOT_VERSION_VARIABLE}).`;
    if (version) { await setCopilotVersion(client, repository, version); return `${COPILOT_VERSION_VARIABLE} set to ${version} for hosted planning.`; }
  } catch (error) {
    return `Could not check or set ${COPILOT_VERSION_VARIABLE} (${error instanceof Error ? error.message : "GitHub request failed"}). Hosted planning fails until it is set: ${copilotVersionCommand(repository, version)}`;
  }
  return `Hosted planning fails until an approved Copilot CLI version is set: ${copilotVersionCommand(repository)}`;
}

export async function installSetup(root: string, value: unknown, options: { apply: boolean; guidance: "apply" | "skip"; skipLabels: boolean; json?: boolean; copilotVersion?: string | undefined }, client?: GitHubApi): Promise<string> {
  const raw = record(value, "setup proposal");
  if (raw.status === "clarification") throw new Error("Answer the setup questions and rerun init before creating a team.");
  const config = setupConfiguration(raw);
  const existingConstitution = config.constitution && await optionalText(await safePath(root, config.constitution)) !== null ? config.constitution : null;
  const proposal = options.guidance === "apply" ? { ...raw, config } : {
    ...raw, instructions: [], constitutionText: null,
    config: { ...config, constitution: raw.constitutionText ? existingConstitution : config.constitution },
  };
  const kept: string[] = [];
  const changes = await installation(root, proposal, undefined, kept);
  const labels = options.skipLabels ? [] : setupLabels(config);
  const copilotVersion = options.copilotVersion === undefined ? undefined : copilotVersionOf(options.copilotVersion);
  const planning = config.planning?.enabled === true && !options.skipLabels;
  if (!options.apply) return options.json ? json({ files: changes.map(describeInstallationFile), kept, labels, repository: config.repository, ...(planning && copilotVersion ? { copilotVersion } : {}) })
    : renderInstallationPreview(changes, labels, config.repository, kept)
      + (planning && copilotVersion ? `\nACTIONS VARIABLE | ${COPILOT_VERSION_VARIABLE}=${copilotVersion} if unset` : "");
  if (!options.skipLabels) {
    if (!config.repository) throw new Error("Set repository before creating GitHub labels, or explicitly use --skip-labels for offline setup.");
    if (!client) throw new Error("GitHub authentication is required to create setup labels.");
    await requireWriter(client, config.repository);
  }
  await applyInstallation(root, changes);
  if (!options.skipLabels && client) {
    try { await ensureLabels(client, config); }
    catch (error) {
      throw new Error(`Local setup was applied, but GitHub labels are incomplete. Rerun the same init --proposal ... --apply command; matching labels are preserved. ${error instanceof Error ? error.message : "Label creation failed."}`);
    }
  }
  const variable = planning && client ? ` ${await planningVariable(client, config.repository, copilotVersion)}` : "";
  return `Applied ${changes.length} reviewed file changes (${changes.filter((change) => change.before !== null && change.after !== null).length} existing files updated, ${changes.filter((change) => change.after === null).length} original agents archived). ${options.skipLabels ? "GitHub labels explicitly skipped." : "All Crewbie workflow and specialist labels are available."}${variable}`;
}

export async function initCommand(root: string, options: InitOptions, io: InitIO): Promise<void> {
  const report = io.report ?? console.log;
  const terminal = !io.ask && !options.json && process.stdin.isTTY && process.stdout.isTTY ? terminalPrompts() : undefined;
  const ask = io.ask ?? terminal?.ask;
  const select = io.select ?? terminal?.select;
  const confirm = io.confirm ?? terminal?.confirm;
  try {
    if (options.guidance !== undefined && !["apply", "skip"].includes(options.guidance)) throw new Error("--guidance must be apply or skip.");
    if ((options as { approver?: unknown }).approver !== undefined) throw new Error("--approver is no longer supported; repository write access authorizes setup.");
    if (options["model-policy"] !== undefined && !["fixed", "cost-aware"].includes(options["model-policy"])) throw new Error("--model-policy must be fixed or cost-aware.");
    if (options["model-profile"] !== undefined) modelProfile(options["model-profile"]);
    if (options.start !== undefined) parseConfig({ schemaVersion: 1, repository: "", roles: [{ id: "developer", purpose: "Validate start.", model: "model" }], constitution: null, maxActive: 1, nightly: { enabled: false, maxRecords: 1, allowedPaths: [] }, ado: null, local: { start: options.start } });
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
      if (options.apply && hasGuidance && !guidance && select) guidance = await select("Apply proposed guidance and constitution too?", [
        { value: "skip", name: "Team only", description: "Keep existing guidance unchanged." },
        { value: "apply", name: "Team + guidance", description: "Apply the concrete replacements in the reviewed proposal." },
      ], "skip");
      else if (options.apply && hasGuidance && !guidance && ask) guidance = (await ask("Apply proposed guidance/constitution too? Enter apply or skip (team only).")).trim();
      if (options.apply && hasGuidance && !guidance) throw new Error("Choose --guidance apply or --guidance skip; guidance changes need a separate decision.");
      if (guidance && !["apply", "skip"].includes(guidance)) throw new Error("Choose apply or skip for guidance.");
      report(await installSetup(root, proposal, {
        apply: options.apply === true, guidance: guidance === "skip" ? "skip" : "apply", skipLabels: options["skip-labels"] === true, json: options.json === true,
        copilotVersion: options["copilot-version"],
      }, options.apply && !options["skip-labels"] ? io.client() : undefined));
      return;
    }
    if (options.apply) throw new Error("Use --proposal with --apply; review the generated setup before noninteractive installation.");
    const assessment = await assess(root);
    if (options.update && assessment.configBeforeHash === null) throw new Error("No installed crew to reassess. Run init without --update first.");
    if (options.repo !== undefined) assessment.config.repository = options.repo;
    if (options["model-profile"] !== undefined) assessment.config.modelProfile = modelProfile(options["model-profile"]);
    assessment.config = parseConfig(assessment.config);
    if (options["assessment-only"]) {
      if (options.out) await writeAtomic(root, options.out, json(assessment));
      report(json(assessment));
      return;
    }
    if (!options.json) report(`\nCrewbie | Setup\n${options.update ? "Reassess the installed team" : "Build a repository-specific team"}\n\n1. Assess  >  2. Review  >  3. Apply\n`);
    let model = options.model ?? "";
    let catalog: ModelChoice[] | undefined;
    if (!model && ask) {
      const models = await (io.listModels ?? listCopilotModels)();
      catalog = models;
      if (!models.length) throw new Error("No available models were returned. Check Copilot access before onboarding.");
      if (select) {
        model = await select("Assessment model (specialist models are reviewed separately)", models.map((choice) => ({
          value: choice.id, name: `${choice.name} (${choice.id})`,
          description: choice.multiplier === undefined ? "Billing multiplier unavailable; assessment may consume AI credits." : `${choice.multiplier}x billing multiplier; not a token-price estimate.`,
        })), models[0]!.id);
        if (!models.some((choice) => choice.id === model)) throw new Error("Choose an assessment model from the inspected catalog.");
      } else {
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
    if (!ask && !description.trim() && assessment.inventory.mode === "greenfield") {
      throw new Error("Greenfield setup needs a project description. Rerun init --description \"purpose, users, behavior, platform and constraints\"; no team was generated.");
    }
    report(`\n1. Assess\n  Model: ${model}\n  Reviewing instructions, agents, constitution and MCP metadata only; application code and project files are not read.\n  This may take several minutes and consume AI credits; press Ctrl+C to cancel.\n  No project scripts or MCP servers are run; installation requires confirmation.\n`);
    const propose = () => proposeSetup(assessment, description, model, {
      ...(io.analyze ? { analyze: io.analyze } : {}), ...(ask ? { ask } : {}), report,
      models: dynamic ? catalog ?? [] : [], specialistModel: options["specialist-model"] ?? model,
    });
    let proposal = await propose();
    if (options.start !== undefined) proposal.config.local = { start: parseConfig({ ...proposal.config, local: { start: options.start } }).local!.start };
    else if (!proposal.config.local?.start && terminal?.ask) {
      const suggestion = await suggestedStartCommand(root);
      const prompt = suggestion
        ? `Command to start the app locally when testing a feature? Press Enter for ${suggestion}. Leave empty to skip.`
        : "Command to start the app locally when testing a feature? Leave empty to skip.";
      const answer = (await terminal.ask(prompt)).trim() || suggestion || "";
      if (answer) proposal.config.local = { start: parseConfig({ ...proposal.config, local: { start: answer } }).local!.start };
    }
    // The CLI catalog includes models the cloud agent rejects; check only the chosen ones, since each check leaves a failed task.
    const checked = new Map<string, boolean>();
    while (proposal.status === "ready" && proposal.config.repository) {
      const installed = new Map(assessment.installedRoles.map((role) => [role.id, role.model]));
      const unchecked = [...new Set(proposal.config.roles.map((role) => role.model))].filter((id) => !checked.has(id));
      if (unchecked.length) {
        let client: GitHubApi;
        try { client = io.client(); } catch { report("  Cloud-agent model support not checked (no GitHub credential); dispatch checks it before launch."); break; }
        for (const id of unchecked) checked.set(id, await cloudAgentAccepts(client, proposal.config.repository, id));
      }
      const kept = proposal.config.roles.filter((role) => installed.get(role.id) === role.model && checked.get(role.model) === false);
      for (const role of kept) report(`  Warning: the Copilot cloud agent rejects installed model ${role.model} for ${role.id}; its launches stay blocked until you choose another model for it.`);
      const rejected = [...new Set(proposal.config.roles.filter((role) => installed.get(role.id) !== role.model && checked.get(role.model) === false).map((role) => role.model))];
      if (!rejected.length) break;
      if (!dynamic) throw new Error(`The Copilot cloud agent rejects specialist model ${rejected.join(", ")} for this account, although the CLI lists it. Choose another --specialist-model; no team was installed.`);
      catalog = (catalog ?? []).filter((choice) => !rejected.includes(choice.id));
      if (!catalog.length) throw new Error("The Copilot cloud agent accepts none of the catalog models for this account; no team was installed.");
      report(`  The Copilot cloud agent rejects ${rejected.join(", ")} for this account, although the CLI lists it. Reassessing without it.`);
      proposal = await propose();
    }
    const output = options.out ?? "crewbie-setup.json";
    const markdown = setupReportPath(output);
    await writeAtomic(root, output, json(proposal));
    await writeAtomic(root, markdown, renderSetupMarkdown(proposal));
    report(`\nSaved for review\n  Assessment: ${markdown}\n  Editable setup: ${output}\n`);
    if (proposal.status === "clarification") {
      throw new Error(`Setup needs clarification; questions saved in ${output}. Rerun init with an expanded --description. No team was installed.`);
    }
    if (!ask) {
      report(`Assessment and tailored team saved to ${output}. Review, then run init --proposal ${output} --apply --guidance apply|skip. GitHub labels are created on apply.`);
      return;
    }
    const choices = [
      { value: "team", name: "Team", description: "Adopt/create the proposed agents; leave existing guidance unchanged." },
      { value: "all", name: "All", description: `Create the team and apply ${proposal.instructions.length} guidance edits${proposal.constitutionText ? " plus the proposed constitution" : ""}.` },
      { value: "save", name: "Save", description: "Keep the assessment and proposal for later. No installation or GitHub changes." },
    ];
    const choice = select ? await select("Install this proposal?", choices, "save")
      : (await ask(`Install this proposal? Enter team (adopt/create agents; skip guidance edits), all (also apply ${proposal.instructions.length} guidance edits${proposal.constitutionText ? " and the proposed constitution" : ""}), or save (no installation).`)).trim().toLowerCase();
    if (!["team", "all", "save"].includes(choice)) throw new Error(`Unknown choice; proposal saved to ${output}. Nothing installed.`);
    if (choice === "save") { report(`Saved only. No files installed or GitHub labels changed.\nResume: crewbie init --proposal "${output}" --apply --guidance apply|skip`); return; }
    if (!proposal.config.planning?.enabled) {
      let planning: string;
      const message = `Enable hosted planning using ${model}? New installations allow paid implementation after your exact-head approval and merge; existing execution opt-outs are preserved.`;
      if (confirm) planning = await confirm(message, false) ? "yes" : "no";
      else {
        do { planning = (await ask(`${message} Enter yes or no.`)).trim().toLowerCase(); }
        while (!["yes", "no"].includes(planning));
      }
      if (planning === "yes") proposal.config.planning = { enabled: true, model,
        executeOnMerge: assessment.configBeforeHash === null ? true : proposal.config.planning?.executeOnMerge === true };
      else report("Hosted planning stays disabled. The ready-for-planning label will not create a plan.");
    }
    if (!proposal.config.repository && !options["skip-labels"]) proposal.config.repository = (await ask("GitHub repository (owner/name) for workflow labels?")).trim();
    let copilotVersion = options["copilot-version"] === undefined ? undefined : copilotVersionOf(options["copilot-version"]);
    if (proposal.config.planning?.enabled && !options["skip-labels"] && proposal.config.repository && copilotVersion === undefined
      && await Promise.resolve().then(() => copilotVersionVariable(io.client(), proposal.config.repository)).catch(() => null) === null) {
      const latest = await io.latestCopilotVersion?.();
      const message = `Copilot CLI version for hosted planning? Sets the missing ${COPILOT_VERSION_VARIABLE} Actions variable.`
        + (latest ? ` Press Enter for the latest release, ${latest}.` : " Leave empty to set it later.");
      for (;;) {
        const answer = (await ask(message)).trim() || latest;
        if (!answer) { report(`Hosted planning fails until you run: ${copilotVersionCommand(proposal.config.repository)}`); break; }
        try { copilotVersion = copilotVersionOf(answer); break; } catch (error) { report(error instanceof Error ? error.message : String(error)); }
      }
    }
    const selected = selectGuidance(proposal, choice === "all");
    await writeAtomic(root, output, json(proposal));
    await writeAtomic(root, markdown, renderSetupMarkdown(proposal, await installation(root, selected))
      + `\n## Installation choice\n\n${choice === "all" ? "Team plus the concrete guidance edits listed above." : "Team only. Proposed guidance edits remain in the saved proposal but will not be applied in this run."}\n`);
    report("\n3. Apply");
    report(await installSetup(root, selected, { apply: false, guidance: "apply", skipLabels: options["skip-labels"] === true, copilotVersion }));
    const approved = confirm ? await confirm("Apply exactly these files and labels?", false)
      : (await ask("Apply exactly these files and labels? Enter yes to confirm.")).trim().toLowerCase() === "yes";
    if (!approved) { report("Not applied. The saved proposal remains available for review."); return; }
    report(await installSetup(root, selected, { apply: true, guidance: "apply", skipLabels: options["skip-labels"] === true, copilotVersion }, options["skip-labels"] ? undefined : io.client()));
    proposal.configBeforeHash = textHash(json(selected.config));
    await writeAtomic(root, output, json(proposal));
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") throw new Error("Setup cancelled. Any saved proposal remains available; no installation was performed.");
    throw error;
  }
}
