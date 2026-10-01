import { bounded, hash, json, modelJson, record, string, strings, withoutComments } from "../core.js";
import { limitsFor, type Config } from "../config.js";
import { SHARED_HOT } from "../memory/context.js";
import { outputCheck, outputIssues, OutputValidationError, type OutputIssue, type OutputSchema } from "../structured-output.js";
import { parseBatch, type Batch } from "./batch.js";
import { acceptanceCriteriaSection, taskBody } from "./acceptance.js";

export interface PlanningSource { number: number; title: string; body: string; revision: string; labelEvent: number }
export interface Plan { summary: string; questions: string[]; teamSuggestions: string[]; batch: Batch | null; decisions: string | null }
export const PLANNING_OUTPUT_BYTES = 100_000;
export const PLANNING_TASK_LIMIT = 8;
export { PLANNING_REPAIR_LIMIT } from "../config.js";
export const PLANNING_FILES = {
  input: ".crewbie-planning-input.json", prompt: ".crewbie-planning-prompt.txt",
  output: ".crewbie-planning-output.txt", report: ".crewbie-planning-validation.json",
};

const text: OutputSchema = { type: "string", minLength: 1 };
const SECRET = /-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}/;
const slug: OutputSchema = { ...text, pattern: "^[a-z][a-z0-9-]{0,63}$" };
const list = (items: OutputSchema, maxItems?: number): OutputSchema => ({ type: "array", items, ...(maxItems === undefined ? {} : { maxItems }) });

/** Shared by prompt generation and local validation. Legacy task bodies remain readable after an upgrade. */
export function planningOutputSchema(config: Config): OutputSchema {
  const common = {
    id: slug, title: text, owner: { ...text, enum: config.roles.map((role) => role.id) },
    model: { ...text, enum: [...new Set(config.roles.map((role) => role.model))] },
    priority: { type: "integer" as const, minimum: 0, maximum: 1000 },
    dependsOn: list(slug), kind: { type: "string" as const, enum: ["implementation", "review"] },
  };
  const required = ["id", "title", "owner", "model", "priority", "dependsOn"];
  return {
    type: "object", required: ["summary", "questions", "batch"], properties: {
      summary: { ...text, description: "Explain the plan; aim for 100 words. Longer summaries are preserved." },
      questions: list(text, 5), teamSuggestions: list(text, 3),
      decisions: { anyOf: [{ type: "null" }, { ...text, description: `Complete Markdown content of ${SHARED_HOT}, as a string. Never a path/content object.` }] },
      batch: { anyOf: [{ type: "null" }, {
        type: "object", required: ["schemaVersion", "id", "tasks"], properties: {
          schemaVersion: { const: 1 }, id: slug, approval: { type: "null" },
          tasks: { type: "array", minItems: 1, maxItems: PLANNING_TASK_LIMIT, items: { anyOf: [
            { type: "object", required: [...required, "scope", "acceptanceCriteria"], properties: {
              ...common, scope: text, acceptanceCriteria: { ...list(text), minItems: 1 },
            } },
            { type: "object", description: "Legacy output only; prefer scope and acceptanceCriteria.", required: [...required, "body"], properties: { ...common, body: text } },
          ] } },
        },
      }] },
    },
  };
}

/** Validate semantic policy after shape validation; the publisher calls this again with the installed config. */
export function parsePlan(value: unknown, config: Config, source: PlanningSource): Plan {
  const data = record(value, "coordinator plan");
  const summary = string(data.summary, "plan summary");
  const questions = strings(data.questions, "planning questions");
  const teamSuggestions = data.teamSuggestions === undefined ? [] : strings(data.teamSuggestions, "team suggestions");
  const issues: OutputIssue[] = [];
  if (questions.length > 5) issues.push({ path: "$.questions", message: "Keep at most five planning questions." });
  questions.forEach((question, index) => outputCheck(issues, `$.questions[${index}]`, () => bounded(question, 60, "Planning question")));
  if (teamSuggestions.length > 3) issues.push({ path: "$.teamSuggestions", message: "Keep at most three team suggestions." });
  teamSuggestions.forEach((suggestion, index) => outputCheck(issues, `$.teamSuggestions[${index}]`, () => bounded(suggestion, 60, "Team suggestion")));
  let decisions: string | null = null;
  if (data.decisions !== undefined && data.decisions !== null) outputCheck(issues, "$.decisions", () => {
    decisions = string(data.decisions, "shared decisions");
    bounded(withoutComments(decisions), limitsFor(config).hot, SHARED_HOT);
    if (!decisions.endsWith("\n")) decisions += "\n";
  });
  let batch: Batch | null = null;
  if (data.batch !== null) outputCheck(issues, "$.batch", () => {
    const raw = record(data.batch, "planning batch");
    if (raw.approval != null) throw new Error("The coordinator cannot approve its own plan.");
    batch = parseBatch({ ...raw, id: `issue-${source.number}`, spec: `Implement the user-supplied requirements at https://github.com/${config.repository}/issues/${source.number}. Source revision: ${source.revision}. Task acceptance criteria below map that scope to specialist-owned work.`, approval: null, sources: [{
      uri: `https://github.com/${config.repository}/issues/${source.number}`,
      revision: source.revision, fingerprint: hash(`${source.title}\n\n${source.body}`),
    }] }, config);
    if (batch.tasks.length > PLANNING_TASK_LIMIT) throw new Error("Split plans exceeding eight tasks before publication.");
    if (batch.tasks.some((task) => task.adoWorkItem !== undefined)) throw new Error("ADO task linkage needs separate human review, not inferred planning output.");
  });
  else if (!questions.length) issues.push({ path: "$.questions", message: "A plan without tasks must explain what needs clarification." });
  if (SECRET.test(json({ summary, questions, teamSuggestions, batch, decisions }))) {
    throw new OutputValidationError([{ path: "$", message: "Planning output appears to contain a secret; nothing will be published." }], false);
  }
  if (issues.length) throw new OutputValidationError(issues);
  return { summary, questions, teamSuggestions, batch, decisions };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Only reversible representation changes are allowed here. No inference, truncation or policy changes. */
function normalize(value: unknown): { value: unknown; normalizations: OutputIssue[]; issues: OutputIssue[] } {
  const data: unknown = structuredClone(value);
  const normalizations: OutputIssue[] = [];
  const issues: OutputIssue[] = [];
  if (!object(data)) return { value: data, normalizations, issues };
  if (Array.isArray(data.teamSuggestions)) data.teamSuggestions = data.teamSuggestions.map((item, index) => {
    if (object(item) && exactKeys(item, ["note"]) && typeof item.note === "string") {
      normalizations.push({ path: `$.teamSuggestions[${index}]`, message: "Converted a note object to its unchanged text." });
      return item.note;
    }
    return item;
  });
  if (object(data.decisions) && exactKeys(data.decisions, ["path", "content"]) && data.decisions.path === SHARED_HOT && typeof data.decisions.content === "string") {
    normalizations.push({ path: "$.decisions", message: "Used the complete content for the fixed shared decisions path." });
    data.decisions = data.decisions.content;
  }
  if (object(data.batch) && Array.isArray(data.batch.tasks)) data.batch.tasks = data.batch.tasks.map((task, index) => {
    if (!object(task) || !("scope" in task || "acceptanceCriteria" in task)) return task;
    const path = `$.batch.tasks[${index}]`;
    if ("body" in task) {
      issues.push({ path, message: "Supply scope and acceptanceCriteria, or a legacy body; both are ambiguous." });
      return task;
    }
    const invalid = outputIssues(task.scope, text, `${path}.scope`);
    invalid.push(...outputIssues(task.acceptanceCriteria, { ...list(text), minItems: 1 }, `${path}.acceptanceCriteria`));
    if (typeof task.scope === "string" && acceptanceCriteriaSection(task.scope) !== null) invalid.push({ path: `${path}.scope`, message: "Keep acceptance criteria in acceptanceCriteria; scope must not contain another Acceptance criteria heading." });
    if (invalid.length) { issues.push(...invalid); return task; }
    const { scope, acceptanceCriteria, ...rest } = task;
    normalizations.push({ path: `${path}.body`, message: "Rendered scope and acceptanceCriteria as the task's Markdown body." });
    return { ...rest, body: taskBody(scope as string, acceptanceCriteria as string[]) };
  });
  return { value: data, normalizations, issues };
}

/** Unsafe output is stopped without an automatic correction that could erase evidence of it. */
function policyIssues(value: unknown, config: Config): OutputIssue[] {
  if (SECRET.test(json(value))) {
    return [{ path: "$", message: "Planning output appears to contain a secret; nothing will be published." }];
  }
  if (!object(value)) return [];
  const issues: OutputIssue[] = [];
  if (object(value.decisions) && "path" in value.decisions && value.decisions.path !== SHARED_HOT) issues.push({ path: "$.decisions.path", message: `Decisions may only target ${SHARED_HOT}.` });
  if (!object(value.batch)) return issues;
  if (value.batch.approval != null) issues.push({ path: "$.batch.approval", message: "The coordinator cannot approve its own plan." });
  if (Array.isArray(value.batch.tasks)) value.batch.tasks.forEach((task, index) => {
    if (!object(task)) return;
    const path = `$.batch.tasks[${index}]`;
    if (task.adoWorkItem !== undefined) issues.push({ path: `${path}.adoWorkItem`, message: "ADO task linkage needs separate human review." });
    if (typeof task.owner === "string" && typeof task.model === "string" && !config.roles.some((role) => role.id === task.owner && role.model === task.model)) {
      issues.push({ path: `${path}.owner`, message: "Task owner/model does not match approved configuration; reassignment needs review." });
    }
  });
  return issues;
}

export function readPlanningOutput(output: string, config: Config, source: PlanningSource): { plan: Plan; normalizations: OutputIssue[] } {
  if (!output.trim() || Buffer.byteLength(output) > PLANNING_OUTPUT_BYTES) throw new OutputValidationError([{ path: "$", message: "Planning output is missing or exceeds 100 KB." }], false);
  if (SECRET.test(output)) throw new OutputValidationError([{ path: "$", message: "Planning output appears to contain a secret; nothing will be published." }], false);
  let raw: unknown;
  try { raw = modelJson(output, "Planning output"); }
  catch (error) { throw new OutputValidationError([{ path: "$", message: error instanceof Error ? error.message : "Invalid JSON." }]); }
  const unsafe = policyIssues(raw, config);
  if (unsafe.length) throw new OutputValidationError(unsafe, false);
  const normalized = normalize(raw);
  const issues = [...normalized.issues, ...outputIssues(normalized.value, planningOutputSchema(config))];
  if (issues.length) throw new OutputValidationError(issues, true, normalized.normalizations);
  try { return { plan: parsePlan(normalized.value, config, source), normalizations: normalized.normalizations }; }
  catch (error) {
    if (error instanceof OutputValidationError) throw new OutputValidationError(error.issues, error.repairable, normalized.normalizations);
    throw error;
  }
}
