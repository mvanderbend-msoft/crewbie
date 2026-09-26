import { mergeFor, type Config } from "../config.js";
import { GitHubError, integer, record, string } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";

/** Copilot leaves finished PRs as drafts; Crewbie marks them ready once the session completed and attribution ran. */
export async function markReady(client: GitHubApi, pr: Record<string, unknown>): Promise<boolean> {
  if (pr.draft !== true || pr.state !== "open") return false;
  const response = record(await client.request("POST", "/graphql", {
    query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}",
    variables: { id: string(pr.node_id, "PR node ID") },
  }), "ready-for-review response");
  if (Array.isArray(response.errors) && response.errors.length) throw new Error(`GitHub did not mark PR #${pr.number} ready for review.`);
  return true;
}

/** Reads check runs and statuses; the dispatch job sets its checks-scoped GITHUB_TOKEN so the user credential needs no Checks access. */
export const CHECK_READER: { client?: GitHubApi } = {};

const PASSED = new Set(["success", "skipped", "neutral"]);

/** Every check on the head passed. Re-runs of one check keep only the newest; the running dispatch job itself is excluded. */
export function checksPassed(runs: Record<string, unknown>[], statuses: Record<string, unknown>[]): string | null {
  const newest = new Map<string, Record<string, unknown>>();
  for (const run of runs) {
    const app = run.app === null || run.app === undefined ? "" : String(record(run.app, "check app").slug);
    if (app === "github-actions" && run.name === "dispatch") continue;
    const key = `${app}/${String(run.name)}`;
    const current = newest.get(key);
    if (!current || integer(run.id, "check run ID") > integer(current.id, "check run ID")) newest.set(key, run);
  }
  for (const run of newest.values()) {
    if (run.status !== "completed") return `Waiting for check ${String(run.name)}.`;
    if (!PASSED.has(String(run.conclusion))) return `Check ${String(run.name)} is ${String(run.conclusion)}.`;
  }
  const latest = new Map<string, Record<string, unknown>>();
  for (const status of statuses) if (!latest.has(String(status.context))) latest.set(String(status.context), status);
  for (const status of latest.values()) {
    if (status.state === "pending") return `Waiting for status ${String(status.context)}.`;
    if (status.state !== "success") return `Status ${String(status.context)} is ${String(status.state)}.`;
  }
  return null;
}

async function matchesDefault(client: GitHubApi, prefix: string, base: string, file: Record<string, unknown>): Promise<boolean> {
  const path = String(file.filename).split("/").map(encodeURIComponent).join("/");
  let current: string | null;
  try { current = String(record(await client.request("GET", `${prefix}/contents/${path}?ref=${encodeURIComponent(base)}`), "workflow file").sha); }
  catch (error) { if (error instanceof GitHubError && error.status === 404) current = null; else throw error; }
  return file.status === "removed" ? current === null : typeof file.sha === "string" && file.sha === current;
}

/** Merges a ready task PR at the completed session's head once every check passed and GitHub reports it mergeable. Never bypasses protection. */
export async function autoMerge(client: GitHubApi, config: Config, number: number, reviewed: string): Promise<{ merged: boolean; reason: string }> {
  const merge = mergeFor(config);
  const prefix = `/repos/${config.repository}`;
  const vetted = "Session completed on";
  const pr = record(await client.request("GET", `${prefix}/pulls/${number}`), "pull request");
  if (pr.state !== "open") return { merged: false, reason: "PR is not open." };
  if (pr.draft === true) return { merged: false, reason: "PR is still a draft." };
  const head = string(record(pr.head, "PR head").sha, "PR head SHA");
  if (head !== reviewed) return { merged: false, reason: "The PR head changed; waiting for the next dispatch run." };
  // Workflows on the feature branch run with repository secrets for PRs into it, so a person merges workflow changes.
  // A workflow file identical to the default branch (for example brought in by merging it) is not a change a person must vet.
  const files = (await client.list(`${prefix}/pulls/${number}/files`)).filter((file) => String(file.filename).startsWith(".github/workflows/"));
  const workflows: string[] = [];
  if (files.length) {
    const base = string(record(await client.request("GET", prefix), "repository").default_branch, "default branch");
    for (const file of files) if (!await matchesDefault(client, prefix, base, file)) workflows.push(String(file.filename));
  }
  if (workflows.length) return { merged: false, reason: `PR #${number} changes ${workflows.join(", ")}; review and merge it yourself.` };
  const checks = CHECK_READER.client ?? client;
  const runs = record(await checks.request("GET", `${prefix}/commits/${head}/check-runs?per_page=100`), "check runs");
  if (!Array.isArray(runs.check_runs) || integer(runs.total_count, "check run count", 0) > runs.check_runs.length) {
    return { merged: false, reason: "Not every check run could be read; merge manually after verifying checks." };
  }
  const combined = record(await checks.request("GET", `${prefix}/commits/${head}/status`), "commit status");
  const statuses = Array.isArray(combined.statuses) ? combined.statuses.map((status) => record(status, "commit status")) : [];
  // Crewbie assumes no CI and no Actions settings: checks that ran must pass, but none running (no CI, branch filters or
  // runs held for approval) does not block, because the human-merged feature PR into the default branch is the gate.
  const ran = runs.check_runs.map((run) => record(run, "check run")).filter((run) => run.conclusion !== "action_required");
  const waiting = checksPassed(ran, statuses);
  if (waiting) return { merged: false, reason: `${vetted} ${head.slice(0, 7)}. ${waiting}` };
  if (pr.mergeable === false) return { merged: false, reason: "The PR conflicts with its base branch; resolve it, then Crewbie merges on its next run." };
  if (pr.mergeable !== true) return { merged: false, reason: "GitHub is still computing mergeability; Crewbie retries on its next run." };
  try {
    const result = record(await client.request("PUT", `${prefix}/pulls/${number}/merge`, { sha: head, merge_method: merge.method }), "merge result");
    if (result.merged !== true) return { merged: false, reason: `GitHub did not confirm the merge of PR #${number}.` };
  } catch (error) {
    if (error instanceof GitHubError && [405, 409, 422].includes(error.status)) {
      return { merged: false, reason: `GitHub refused the merge (HTTP ${error.status}); branch protection or a new head may apply.` };
    }
    throw error;
  }
  const verified = ran.length || statuses.length ? "every check passed" : "no checks ran on it; the feature PR is where it gets tested";
  return { merged: true, reason: `Auto-merged ${head.slice(0, 7)} into ${string(record(pr.base, "PR base").ref, "base branch")}: the session completed and ${verified}.` };
}