import { mergeFor, type Config } from "../config.js";
import { GitHubError, integer, record, string } from "../core.js";
import { isApprover, type GitHubApi } from "../tracking/github.js";

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

/** Latest review of each configured approver: approved on the current head, and no approver requesting changes. */
export function approvedBy(reviews: Record<string, unknown>[], config: Config, head: string): string | null {
  const latest = new Map<string, Record<string, unknown>>();
  for (const review of reviews) {
    if (!isApprover(review.user, config.approvers) || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(String(review.state))) continue;
    latest.set(String(record(review.user, "reviewer").login), review);
  }
  const states = [...latest.values()];
  if (states.some((review) => review.state === "CHANGES_REQUESTED")) return null;
  const approval = states.find((review) => review.state === "APPROVED" && review.commit_id === head);
  return approval ? String(record(approval.user, "reviewer").login) : null;
}

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

/** Merges a ready PR once a configured approver approved its current head and every check passed. Never bypasses protection. */
export async function mergeApproved(client: GitHubApi, config: Config, pull: Record<string, unknown>): Promise<{ merged: boolean; reason: string }> {
  const merge = mergeFor(config);
  const number = integer(pull.number, "PR number");
  const prefix = `/repos/${config.repository}`;
  if (!merge.auto) return { merged: false, reason: "Auto-merge is disabled; merge after review." };
  const pr = record(await client.request("GET", `${prefix}/pulls/${number}`), "pull request");
  if (pr.state !== "open") return { merged: false, reason: "PR is not open." };
  if (pr.draft === true) return { merged: false, reason: "PR is still a draft." };
  const head = string(record(pr.head, "PR head").sha, "PR head SHA");
  const approver = approvedBy(await client.list(`${prefix}/pulls/${number}/reviews`), config, head);
  if (!approver) return { merged: false, reason: "Awaiting a configured approver's approval of the current head; Crewbie then merges automatically." };
  const runs = record(await client.request("GET", `${prefix}/commits/${head}/check-runs?per_page=100`), "check runs");
  if (!Array.isArray(runs.check_runs) || integer(runs.total_count, "check run count", 0) > runs.check_runs.length) {
    return { merged: false, reason: "Approved, but not every check run could be read; merge manually after verifying checks." };
  }
  const combined = record(await client.request("GET", `${prefix}/commits/${head}/status`), "commit status");
  const statuses = Array.isArray(combined.statuses) ? combined.statuses.map((status) => record(status, "commit status")) : [];
  const waiting = checksPassed(runs.check_runs.map((run) => record(run, "check run")), statuses);
  if (waiting) return { merged: false, reason: `Approved by ${approver}. ${waiting}` };
  if (pr.mergeable === false) return { merged: false, reason: `Approved by ${approver}, but the PR has conflicts with its base branch.` };
  if (pr.mergeable !== true) return { merged: false, reason: `Approved by ${approver}; GitHub is still computing mergeability.` };
  try {
    const result = record(await client.request("PUT", `${prefix}/pulls/${number}/merge`, { sha: head, merge_method: merge.method }), "merge result");
    if (result.merged !== true) return { merged: false, reason: `GitHub did not confirm the merge of PR #${number}.` };
  } catch (error) {
    if (error instanceof GitHubError && [405, 409, 422].includes(error.status)) {
      return { merged: false, reason: `Approved by ${approver}, but GitHub refused the merge (HTTP ${error.status}); branch protection or a new head may apply.` };
    }
    throw error;
  }
  return { merged: true, reason: `Merged after ${approver}'s approval of ${head.slice(0, 7)} with all checks passing.` };
}
