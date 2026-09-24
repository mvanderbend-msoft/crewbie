import { GitHubError, record, string } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";

export const COPILOT_VERSION_VARIABLE = "CREWBIE_COPILOT_VERSION";
// Must match the check in the generated planning workflow.
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][A-Za-z0-9.-]+)?$/;

export function copilotVersion(value: string): string {
  const version = value.trim();
  if (!EXACT_VERSION.test(version)) throw new Error(`Copilot CLI version must be exact, for example 1.0.88; got "${value}".`);
  return version;
}

export function copilotVersionCommand(repository: string, version = "VERSION"): string {
  return `gh variable set ${COPILOT_VERSION_VARIABLE} --repo ${repository} --body "${version}"`;
}

export async function copilotVersionVariable(client: GitHubApi, repository: string): Promise<string | null> {
  try {
    return string(record(await client.request("GET", `/repos/${repository}/actions/variables/${COPILOT_VERSION_VARIABLE}`), "Copilot version variable").value, COPILOT_VERSION_VARIABLE, true) || null;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

export async function setCopilotVersion(client: GitHubApi, repository: string, version: string): Promise<void> {
  await client.request("POST", `/repos/${repository}/actions/variables`, { name: COPILOT_VERSION_VARIABLE, value: copilotVersion(version) });
}

export async function latestCopilotVersion(): Promise<string | undefined> {
  try {
    const response = await fetch("https://registry.npmjs.org/@github/copilot/latest", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const version = (await response.json() as { version?: unknown }).version;
    return typeof version === "string" && EXACT_VERSION.test(version) ? version : undefined;
  } catch { return undefined; }
}
