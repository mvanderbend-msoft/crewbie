import type { Config } from "../config.js";
import { ADDRESS_REVIEW_LABEL, limitsFor, PLANNING_LABEL, RESTART_LABEL, requireExecution } from "../config.js";
import { GitHubError, hash, integer, record, string } from "../core.js";
import { checkPrDescription } from "../specification/prose.js";
import { batchDigest, issueBody, issueDigest, requireApproval, taskMetadata, type Batch } from "../specification/batch.js";
import { isApprover, requireApprover, type GitHubApi } from "./github.js";
import { verifySources } from "./sources.js";
import type { AdoApi } from "./ado.js";

export const STATUSES = ["blocked", "ready", "running", "review", "failed", "done"] as const;
export function setupLabels(config: Config): string[] {
  return ["crewbie:managed", PLANNING_LABEL, RESTART_LABEL, ADDRESS_REVIEW_LABEL, ...STATUSES.map((status) => `crewbie:${status}`), ...config.roles.map((role) => `crewbie:owner:${role.id}`)];
}
const LABEL_PURPOSES: Record<string, string> = {
  [RESTART_LABEL]: "Approver request: relaunch a task whose previous session ended; counts as an attempt.",
  [ADDRESS_REVIEW_LABEL]: "Approver request on a PR: the specialist addresses the review and comments; counts as an attempt.",
};
export function labelDescription(name: string): string {
  return LABEL_PURPOSES[name] ?? "Crewbie workflow metadata; approval and prerequisites are checked separately.";
}
export async function ensureLabels(client: GitHubApi, config: Config): Promise<void> {
  const prefix = `/repos/${config.repository}`;
  const existing = new Set((await client.list(`${prefix}/labels`)).map((label) => label.name));
  const labels = setupLabels(config);
  for (const name of labels) {
    if (!existing.has(name)) await client.request("POST", `${prefix}/labels`, { name, color: "b11f4b",
      description: labelDescription(name) });
  }
}
export async function managedIssues(client: GitHubApi, repository: string, state: "all" | "open" | "closed" = "all", since?: Date): Promise<Record<string, unknown>[]> {
  return (await client.list(`/repos/${repository}/issues?state=${state}&labels=crewbie%3Amanaged${since ? `&since=${since.toISOString()}` : ""}`)).filter((issue) => !issue.pull_request);
}
export function approvalComment(digest: string, execute: boolean): string {
  return `Crewbie approval: ${digest}\nExecution: ${execute ? "approved" : "not-approved"}\n\nScope, specialist, model, and dependencies are bound to the issue's exact title and body.`;
}
export async function hasApproval(client: GitHubApi, config: Config, issue: Record<string, unknown>, execute = true): Promise<boolean> {
  string(issue.body, "issue body");
  const comments = await client.list(`/repos/${config.repository}/issues/${integer(issue.number, "issue number")}/comments`);
  return approvedIn(comments, config, issue, execute);
}
/**
 * Moves approved task issues to their owner's current configured model and re-approves the exact new title and body.
 * Only the model in the task metadata changes; scope, owner and dependencies stay bound to the original approval.
 */
export async function reapproveIssues(client: GitHubApi, config: Config, issues: number[], apply: boolean): Promise<string> {
  const lines: string[] = [];
  const changes: { number: number; body: string; title: string; claimed: boolean }[] = [];
  for (const number of issues) {
    const issue = record(await client.request("GET", `/repos/${config.repository}/issues/${number}`), "task issue");
    if (issue.state !== "open") throw new Error(`Issue #${number} is closed; only open tasks can be re-approved.`);
    const body = string(issue.body, "issue body");
    const title = string(issue.title, "issue title");
    const metadata = taskMetadata(body);
    if (!metadata) throw new Error(`Issue #${number} is not a Crewbie task.`);
    const role = config.roles.find((role) => role.id === metadata.task.owner);
    if (!role) throw new Error(`Issue #${number}'s owner ${metadata.task.owner} is not a configured role. Replan it instead.`);
    const payload = { ...metadata, task: { ...metadata.task, model: role.model } };
    const next = body.replace(/<!-- crewbie-task:[A-Za-z0-9+/=]+ -->/, `<!-- crewbie-task:${Buffer.from(JSON.stringify(payload)).toString("base64")} -->`);
    const comments = await client.list(`/repos/${config.repository}/issues/${number}/comments`);
    if (next === body && approvedIn(comments, config, issue)) { lines.push(`#${number}: already approved for crewbie-${role.id} on ${role.model}; nothing to change.`); continue; }
    let claimed = true;
    try { await client.request("GET", `/repos/${config.repository}/git/ref/tags/crewbie/claims/${number}`); }
    catch (error) { if (error instanceof GitHubError && error.status === 404) claimed = false; else throw error; }
    changes.push({ number, body: next, title, claimed });
    lines.push(`#${number}: ${next === body ? "re-approve" : `model ${metadata.task.model} -> ${role.model}`} for crewbie-${role.id}${claimed ? `; add ${RESTART_LABEL} afterwards to relaunch it` : ""}.`);
  }
  if (!apply) return `Preview:\n${lines.join("\n")}\nRepeat with --apply to update the issues and post your execution approval. No agents are started.`;
  if (changes.length) await requireApprover(client, config.approvers);
  for (const change of changes) {
    await client.request("PATCH", `/repos/${config.repository}/issues/${change.number}`, { body: change.body });
    await client.request("POST", `/repos/${config.repository}/issues/${change.number}/comments`, { body: approvalComment(issueDigest(change.title, change.body), true) });
  }
  return `${lines.join("\n")}\n${changes.length ? "Updated and re-approved. No agents were started; dispatch launches unclaimed tasks on its next run." : "Nothing to change."}`;
}
/** hasApproval over comments the caller already fetched. */
export function approvedIn(comments: Record<string, unknown>[], config: Config, issue: Record<string, unknown>, execute = true): boolean {
  const expected = approvalComment(issueDigest(string(issue.title, "issue title"), string(issue.body, "issue body")), execute);
  return comments.some((comment) => isApprover(comment.user, config.approvers) && comment.body === expected && comment.created_at === comment.updated_at);
}
export async function publish(client: GitHubApi, config: Config, batch: Batch, ado?: AdoApi, dispatchWorkflow = true): Promise<{ task: string; issue: number }[]> {
  requireExecution(config);
  requireApproval(batch);
  await requireApprover(client, config.approvers);
  await verifySources(batch.sources, client, config, ado);
  await ensureLabels(client, config);
  const existing = await managedIssues(client, config.repository);
  const results: { task: string; issue: number }[] = [];
  try {
  for (const task of batch.tasks) {
    const candidates = existing.filter((issue) => {
      const data = taskMetadata(String(issue.body ?? ""));
      // A closed issue from an earlier approved revision of this batch is superseded, not a conflict.
      return data?.batch === batch.id && data.task.id === task.id && !(issue.state === "closed" && data.batchDigest !== batchDigest(batch));
    });
    if (candidates.length > 1) throw new Error(`Multiple issues represent ${batch.id}/${task.id}. Reconcile before publishing.`);
    const body = issueBody(batch, task);
    let issue = candidates[0];
    if (issue) {
      const metadata = taskMetadata(String(issue.body ?? ""));
      if (metadata?.batchDigest !== batchDigest(batch) || issue.body !== body || issue.title !== task.title) {
        throw new Error(`Published ${task.id} differs from the approved batch. Reconcile the issue explicitly; no overwrite was attempted.`);
      }
    } else {
      issue = record(await client.request("POST", `/repos/${config.repository}/issues`, {
        title: task.title, body, labels: ["crewbie:managed", `crewbie:owner:${task.owner}`, "crewbie:blocked"],
      }), "created issue");
      existing.push(issue);
    }
    const number = integer(issue.number, "issue number");
    if (!await hasApproval(client, config, issue, batch.approval?.execute === true)) {
      await client.request("POST", `/repos/${config.repository}/issues/${number}/comments`, { body: approvalComment(issueDigest(task.title, body), batch.approval?.execute === true) });
    }
    results.push({ task: task.id, issue: number });
  }
  // GITHUB_TOKEN-originated labels do not reliably trigger another workflow.
  if (batch.approval?.execute && dispatchWorkflow) {
    const metadata = record(await client.request("GET", `/repos/${config.repository}`), "repository");
    await client.request("POST", `/repos/${config.repository}/actions/workflows/crewbie-dispatch.yml/dispatches`, { ref: string(metadata.default_branch, "default branch") });
  }
  return results;
  } catch (error) {
    throw new Error(`Publication stopped. Confirmed task/issue mappings: ${JSON.stringify(results)}. Reconcile unknown outcomes before retrying; existing matching issues are reused. ${error instanceof Error ? error.message : "Remote request failed."}`);
  }
}
export async function setStatus(client: GitHubApi, repo: string, issue: Record<string, unknown>, status: typeof STATUSES[number]): Promise<void> {
  if (!Array.isArray(issue.labels)) throw new Error("Issue labels are missing.");
  const old = issue.labels.map((label) => typeof label === "string" ? label : string(record(label, "label").name, "label name"));
  const obsolete = old.filter((label) => STATUSES.some((state) => label === `crewbie:${state}`) && label !== `crewbie:${status}`);
  const path = `/repos/${repo}/issues/${integer(issue.number, "issue number")}/labels`;
  if (!old.includes(`crewbie:${status}`)) await client.request("POST", path, { labels: [`crewbie:${status}`] });
  for (const label of obsolete) await client.request("DELETE", `${path}/${encodeURIComponent(label)}`);
}

export async function publishDescription(client: GitHubApi, config: Config, number: number, proposal: unknown, apply = false): Promise<{ before: string; after: string; headSha: string }> {
  if (!config.repository) throw new Error("Configure a repository before finalizing a PR.");
  const data = record(proposal, "PR description proposal");
  const after = string(data.body, "proposed PR description");
  checkPrDescription(after, limitsFor(config).pr);
  const path = `/repos/${config.repository}/pulls/${integer(number, "PR number")}`;
  const pr = record(await client.request("GET", path), "PR");
  const before = typeof pr.body === "string" ? pr.body : "";
  const headSha = string(record(pr.head, "PR head").sha, "PR revision");
  if (pr.state !== "open") throw new Error("Only an open PR can be finalized.");
  if (headSha !== string(data.headSha, "expected head revision") || hash(before) !== string(data.beforeHash, "expected description hash")) {
    throw new Error("PR head or description changed. Review a fresh proposal; nothing was overwritten.");
  }
  if (apply) {
    await requireApprover(client, config.approvers);
    const updated = record(await client.request("PATCH", path, { body: after }), "updated PR");
    if (updated.body !== after) throw new Error("GitHub did not confirm the proposed description. Inspect the PR before retrying.");
  }
  return { before, after, headSha };
}
