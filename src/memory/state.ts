import { json, record, string } from "../core.js";
import { GitHubError } from "../execution/github.js";
import type { GitHubApi } from "../tracking/github.js";

export interface MaintenanceState {
  processed: Record<string, { fingerprint: string; outcome: string }>;
  revision: string | null;
}
const BRANCH = "crewbie/runtime";
export async function readState(client: GitHubApi, repository: string): Promise<MaintenanceState> {
  let ref: Record<string, unknown>;
  try {
    ref = record(await client.request("GET", `/repos/${repository}/git/ref/heads/${BRANCH}`), "runtime ref");
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return { processed: {}, revision: null };
    throw error;
  }
  const revision = string(record(ref.object, "runtime ref object").sha, "runtime revision");
  const file = record(await client.request("GET", `/repos/${repository}/contents/state.json?ref=${revision}`), "runtime state file");
  if (file.encoding !== "base64") throw new Error("Unexpected runtime state encoding.");
  const data = record(JSON.parse(Buffer.from(string(file.content, "state content"), "base64").toString("utf8")) as unknown, "runtime state");
  if (data.schemaVersion !== 1) throw new Error("Unsupported runtime state version.");
  const processed = record(data.processed, "processed evidence");
  const parsed = Object.fromEntries(Object.entries(processed).map(([id, raw]) => {
    const entry = record(raw, "processed record");
    return [id, { fingerprint: string(entry.fingerprint, "fingerprint"), outcome: string(entry.outcome, "outcome") }];
  }));
  return { processed: parsed, revision };
}
export async function saveState(client: GitHubApi, repository: string, state: MaintenanceState): Promise<void> {
  const prefix = `/repos/${repository}`;
  const tree = record(await client.request("POST", `${prefix}/git/trees`, {
    tree: [{ path: "state.json", mode: "100644", type: "blob", content: json({ schemaVersion: 1, processed: state.processed }) }],
  }), "runtime tree");
  const commit = record(await client.request("POST", `${prefix}/git/commits`, {
    message: "Record reviewed Crewbie evidence\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>", tree: string(tree.sha, "runtime tree SHA"), parents: state.revision ? [state.revision] : [],
  }), "runtime commit");
  const sha = string(commit.sha, "runtime commit SHA");
  if (state.revision) await client.request("PATCH", `${prefix}/git/refs/heads/${BRANCH}`, { sha, force: false });
  else await client.request("POST", `${prefix}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha });
}
