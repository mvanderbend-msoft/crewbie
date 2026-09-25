import { mergeFor, reviewerFor, type Config } from "../config.js";
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

/** Merges the vetted head of a ready PR once every check passed and GitHub reports it mergeable. Never bypasses protection. */
export async function autoMerge(client: GitHubApi, config: Config, number: number, reviewed: string): Promise<{ merged: boolean; reason: string }> {
  const merge = mergeFor(config);
  const prefix = `/repos/${config.repository}`;
  const vetted = reviewerFor(config) ? "Reviewer passed" : "Session completed on";
  const pr = record(await client.request("GET", `${prefix}/pulls/${number}`), "pull request");
  if (pr.state !== "open") return { merged: false, reason: "PR is not open." };
  if (pr.draft === true) return { merged: false, reason: "PR is still a draft." };
  const head = string(record(pr.head, "PR head").sha, "PR head SHA");
  if (head !== reviewed) return { merged: false, reason: reviewerFor(config) ? "The PR changed after its review; awaiting a review of the new head." : "The PR head changed; waiting for the next dispatch run." };
  const runs = record(await client.request("GET", `${prefix}/commits/${head}/check-runs?per_page=100`), "check runs");
  if (!Array.isArray(runs.check_runs) || integer(runs.total_count, "check run count", 0) > runs.check_runs.length) {
    return { merged: false, reason: "Not every check run could be read; merge manually after verifying checks." };
  }
  const combined = record(await client.request("GET", `${prefix}/commits/${head}/status`), "commit status");
  const statuses = Array.isArray(combined.statuses) ? combined.statuses.map((status) => record(status, "commit status")) : [];
  const waiting = checksPassed(runs.check_runs.map((run) => record(run, "check run")), statuses);
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
  return { merged: true, reason: `Auto-merged ${head.slice(0, 7)}: ${reviewerFor(config) ? "the Crewbie reviewer passed it, " : ""}the plan rated it ${merge.minConfidence} or above and every check passed.` };
}