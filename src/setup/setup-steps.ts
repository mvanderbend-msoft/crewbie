import { isMap, parseDocument } from "yaml";

/** GitHub runs this workflow's copilot-setup-steps job before every Copilot cloud agent session. */
export const SETUP_STEPS = ".github/workflows/copilot-setup-steps.yml";
const MAX_CHARACTERS = 6_000;

/**
 * Validates a proposed setup-steps workflow. It runs in the repository's Actions context, so it may only prepare the
 * environment: one copilot-setup-steps job, read-only permissions, no secrets and no privileged triggers.
 */
export function parseSetupSteps(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error("setupSteps must be workflow YAML or null.");
  if (value.length > MAX_CHARACTERS) throw new Error(`setupSteps exceeds ${MAX_CHARACTERS} characters; keep it to dependency installation.`);
  const document = parseDocument(value, { uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error(`setupSteps must be a valid YAML workflow: ${document.errors[0]?.message ?? "not a mapping"}`);
  const workflow = document.toJS() as Record<string, unknown>;
  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== "object" || Object.keys(jobs).join() !== "copilot-setup-steps") {
    throw new Error("setupSteps must define exactly one job named copilot-setup-steps; GitHub runs only that job for Copilot.");
  }
  if (/\$\{\{\s*secrets\./.test(value)) throw new Error("setupSteps must not reference secrets; dependency installation needs none.");
  if (/pull_request_target|workflow_run/.test(value)) throw new Error("setupSteps must not use privileged triggers.");
  if (/:\s*write\b|write-all/.test(value)) throw new Error("setupSteps needs read-only permissions (contents: read).");
  return value.endsWith("\n") ? value : `${value}\n`;
}
