import { reviewerFor, type Config } from "../config.js";
import { GitHubError, hash, integer, record, string } from "../core.js";
import { batchDigest, issueBody, requireApproval, taskMetadata, type Batch } from "../specification/batch.js";
import { isWriter, type GitHubApi } from "../tracking/github.js";
import { approvedIn, ensureLabels, hasApproval, managedIssues, setStatus } from "../tracking/issues.js";
import { verifySources } from "../tracking/sources.js";
import type { AdoApi } from "../tracking/ado.js";
import { attributePull } from "./attribution.js";
import { cloudTasks } from "../tracking/native.js";
import { checkLaunchModels, copilotStartFailure, launchAllowance, listCopilotModels, modelRejection, rejectedLaunchModels, reserveLaunch, RESTART_LABEL, RESTART_MARKER, withDispatchLock, type DiscoverModels } from "./controls.js";
import { autoMerge, markReady } from "./merge.js";
import { requestReview, trustedReview } from "./pr-review.js";
export { withDispatchLock } from "./controls.js";

export type WorkState = "blocked" | "ready" | "running" | "review" | "failed" | "done";
export interface Work {
  issue: Record<string, unknown>;
  metadata: NonNullable<ReturnType<typeof taskMetadata>>;
  state: WorkState;
  approved: boolean;
  claimed: boolean;
  sessionComplete?: boolean;
  /** Verified that no cloud session is still running: native task terminal, or Copilot reported it could not start. */
  sessionEnded?: boolean;
  reason: string;
  pull?: Record<string, unknown>;
  nativeTask?: Record<string, unknown>;
}
export interface FeatureBodyItem {
  issue: Record<string, unknown>;
  metadata: NonNullable<ReturnType<typeof taskMetadata>>;
  pull?: Record<string, unknown>;
}
export function renderDispatchResult(work: Work[], config: Config): string {
  if (!work.length) return [
    "# Crewbie dispatch", "",
    "No managed implementation tasks were found. No agents were started.", "",
    "`crewbie:ready-for-planning` requests a plan; it is not an implementation task or execution approval.",
    config.planning?.enabled
      ? "Hosted planning is enabled. Check the separate Crewbie planning workflow for labelled requirement issues, then review its plan before approving implementation."
      : "Hosted planning is disabled. Enable it explicitly through reviewed init (including its generated workflow), commit the setup, then reapply the ready-for-planning label to request a potentially billable plan.",
    "Alternatively, approve and publish an implementation batch with the local coordinator. Dispatch acts only on managed tasks with current human execution approval.",
  ].join("\n");
  const cell = (text: string) => text.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
  return ["# Crewbie dispatch", "", `Reconciled ${work.length} managed task(s). Reconciliation does not imply every task started.`, "",
    "| Issue | State | Explanation |", "| --- | --- | --- |",
    ...work.map((item) => `| #${item.issue.number} | ${item.state} | ${cell(item.reason)} |`)].join("\n");
}
export { cloudTasks } from "../tracking/native.js";
export async function selectNativeTask(client: GitHubApi, config: Config, issue: number, matches: Record<string, unknown>[]): Promise<Record<string, unknown> | undefined> {
  if (matches.length < 2) return matches[0];
  const comments = await client.list(`/repos/${config.repository}/issues/${issue}/comments`);
  const candidates = new Set<string>();
  for (const comment of comments) {
    if (!await isWriter(client, config.repository, comment.user) || comment.created_at !== comment.updated_at) continue;
    const marker = /^<!-- crewbie-continuation:([A-Za-z0-9+/=]+) -->$/.exec(String(comment.body));
    if (!marker?.[1]) continue;
    const receipt = record(JSON.parse(Buffer.from(marker[1], "base64").toString("utf8")) as unknown, "continuation receipt");
    if (!Array.isArray(receipt.previous) || typeof receipt.task !== "string") continue;
    const ids = [...receipt.previous, receipt.task];
    if (new Set(ids).size !== matches.length || ids.length !== matches.length || !matches.every((task) => ids.includes(task.id))) continue;
    if (!matches.filter((task) => task.id !== receipt.task).every((task) => ["completed", "failed", "timed_out", "cancelled"].includes(String(task.state)))) continue;
    candidates.add(receipt.task);
  }
  if (candidates.size !== 1) return undefined;
  return matches.find((task) => candidates.has(String(task.id)));
}
async function receiptOf(client: GitHubApi, comment: Record<string, unknown>, config: Config): Promise<{ task: string; previous: string[] } | null> {
  if (!await isWriter(client, config.repository, comment.user) || comment.created_at !== comment.updated_at) return null;
  const marker = /^<!-- crewbie-continuation:([A-Za-z0-9+/=]+) -->$/.exec(String(comment.body));
  if (!marker?.[1]) return null;
  try {
    const receipt = record(JSON.parse(Buffer.from(marker[1], "base64").toString("utf8")) as unknown, "continuation receipt");
    return typeof receipt.task === "string" && Array.isArray(receipt.previous) ? { task: receipt.task, previous: receipt.previous.map(String) } : null;
  } catch { return null; }
}
/** A continuation whose task is not yet linked to the PR is still starting; the earlier completed task must not count as the outcome. */
export async function pendingContinuation(client: GitHubApi, comments: Record<string, unknown>[], config: Config, matches: Record<string, unknown>[]): Promise<string | null> {
  let latest: { task: string; previous: string[] } | null = null;
  for (const comment of [...comments].reverse()) {
    latest = await receiptOf(client, comment, config);
    if (latest) break;
  }
  return latest && !matches.some((task) => task.id === latest.task) ? latest.task : null;
}
function copilotAssigned(issue: Record<string, unknown>): boolean {
  return Array.isArray(issue.assignees) && issue.assignees.some((value) => {
    const assignee = record(value, "assignee");
    return ["copilot-swe-agent[bot]", "copilot-swe-agent", "Copilot"].includes(String(assignee.login));
  });
}

const COPILOT_LOGINS = ["copilot-swe-agent[bot]", "copilot-swe-agent", "Copilot"];
const byCopilot = (pr: Record<string, unknown>) => pr.user !== null && COPILOT_LOGINS.includes(String(record(pr.user, "PR author").login));
/**
 * The Copilot PR for a task issue. Default-branch PRs are found through GitHub's closing references; GitHub does not link
 * PRs into a feature branch, so those are found through the issue's cross-references and must target that branch.
 */
export async function linkedPull(client: GitHubApi, repository: string, issue: number, branch?: string): Promise<Record<string, unknown> | null> {
  if (branch) return branchPull(client, repository, issue, branch);
  const pulls: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  const [owner, name] = repository.split("/");
  let after: string | null = null;
  for (let page = 0; page < 100; page++) {
    const response = record(await client.request("POST", "/graphql", {
      query: `query($owner:String!,$name:String!,$number:Int!,$after:String) {
        repository(owner:$owner,name:$name) { issue(number:$number) {
          closedByPullRequestsReferences(first:100,includeClosedPrs:true,after:$after) {
            nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor }
          }
        } }
      }`,
      variables: { owner, name, number: integer(issue, "issue number"), after },
    }), "closing PR references");
    if (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)) {
      throw new Error("GitHub could not establish closing PR references. Check repository permissions before reconciling work.");
    }
    const data = record(response.data, "closing reference data");
    const repo = record(data.repository, "closing reference repository");
    const item = record(repo.issue, "closing reference issue");
    const connection = record(item.closedByPullRequestsReferences, "closing PR connection");
    if (!Array.isArray(connection.nodes)) throw new Error("GitHub returned invalid closing PR references.");
    for (const raw of connection.nodes) {
      const target = record(raw, "closing PR");
      if (string(record(target.repository, "PR repository").nameWithOwner, "PR repository name").toLowerCase() !== repository.toLowerCase()) continue;
      const number = integer(target.number, "closing PR number");
      if (seen.has(number)) continue;
      seen.add(number);
      const pr = record(await client.request("GET", `/repos/${repository}/pulls/${number}`), "pull request");
      if (byCopilot(pr)) pulls.push(pr);
    }
    const info = record(connection.pageInfo, "closing reference page");
    if (typeof info.hasNextPage !== "boolean") throw new Error("Closing-reference pagination is unverified.");
    if (!info.hasNextPage) break;
    const next = string(info.endCursor, "closing reference cursor");
    if (next === after || page === 99) throw new Error("Closing-reference pagination could not complete safely.");
    after = next;
  }
  return pickPull(pulls, issue);
}
async function branchPull(client: GitHubApi, repository: string, issue: number, branch: string): Promise<Record<string, unknown> | null> {
  const pulls: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  for (const event of await client.list(`/repos/${repository}/issues/${integer(issue, "issue number")}/timeline`)) {
    if (event.event !== "cross-referenced" || event.source === null || event.source === undefined) continue;
    const source = record(event.source, "cross-reference source").issue;
    const url = source && typeof source === "object" ? (source as { pull_request?: { url?: unknown } }).pull_request?.url : undefined;
    const match = typeof url === "string" ? /\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(url) : null;
    if (!match || match[1]!.toLowerCase() !== repository.toLowerCase()) continue;
    const number = integer(Number(match[2]), "cross-referencing PR");
    if (seen.has(number)) continue;
    seen.add(number);
    const pr = record(await client.request("GET", `/repos/${repository}/pulls/${number}`), "pull request");
    if (byCopilot(pr) && record(pr.base, "PR base").ref === branch) pulls.push(pr);
  }
  return pickPull(pulls, issue);
}
function pickPull(pulls: Record<string, unknown>[], issue: number): Record<string, unknown> | null {
  // A restart leaves the earlier closed, unmerged PR linked; the current PR is the one that is open or merged.
  const current = pulls.length > 1 ? pulls.filter((pr) => pr.state === "open" || pr.merged_at) : pulls;
  let candidates = current.length || !pulls.length ? current : [pulls.reduce((a, b) => integer(b.number, "PR") > integer(a.number, "PR") ? b : a)];
  // Another task's PR can mention this issue with a closing keyword (for example a review quoting "closes #61"). The earliest
  // merged PR completed the issue; among open PRs, the one titled for this issue is the task's own.
  const merged = candidates.filter((pr) => pr.merged_at).sort((a, b) => String(a.merged_at).localeCompare(String(b.merged_at)));
  if (candidates.length > 1 && merged.length) candidates = [merged[0]!];
  const titled = candidates.filter((pr) => new RegExp(`#${integer(issue, "issue number")}(?!\\d)`).test(String(pr.title ?? "")));
  if (candidates.length > 1 && titled.length === 1) candidates = titled;
  const closing = candidates.filter((pr) => new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issue}(?!\\d)`, "i").test(String(pr.body ?? "")));
  if (candidates.length > 1 && closing.length === 1) candidates = closing;
  if (candidates.length > 1) throw new Error(`Issue #${issue} has multiple candidate agent PRs. Reconcile before dispatch.`);
  return candidates[0] ?? null;
}
/** Closed issues updated within this window are still inspected, so a session that outlives its issue keeps its slot. */
const RECENTLY_CLOSED_MS = 24 * 60 * 60 * 1000;
/**
 * Only open managed issues, recently closed ones and issues a scoped run names are inspected in full. Older closed
 * issues are read only when an open task depends on them, so each run stays proportional to active work.
 */
export async function inspectWork(client: GitHubApi, config: Config, knownIssues: readonly number[] = [], now = new Date()): Promise<Work[]> {
  const all = await managedIssues(client, config.repository, "open");
  const refs = await client.request("GET", `/repos/${config.repository}/git/matching-refs/tags/crewbie/claims/`);
  if (!Array.isArray(refs)) throw new Error("GitHub returned an invalid claim ledger.");
  const claims = new Set<number>();
  for (const raw of refs) {
    const ref = string(record(raw, "claim ref").ref, "claim name");
    const match = /^refs\/tags\/crewbie\/claims\/(\d+)$/.exec(ref);
    if (!match) throw new Error(`Unexpected claim ref: ${ref}`);
    claims.add(integer(Number(match[1]), "claimed issue number"));
  }
  const recent = claims.size ? await managedIssues(client, config.repository, "closed", new Date(now.getTime() - RECENTLY_CLOSED_MS)) : [];
  all.push(...recent.filter((issue) => claims.has(integer(issue.number, "issue number"))));
  for (const number of new Set(knownIssues.map((number) => integer(number, "published issue number")))) {
    if (!all.some((issue) => issue.number === number)) {
      all.push(record(await client.request("GET", `/repos/${config.repository}/issues/${number}`), "published issue"));
    }
  }
  all.sort((a, b) => integer(a.number, "issue number") - integer(b.number, "issue number"));
  const result: Work[] = [];
  let telemetry: ReturnType<typeof cloudTasks> | undefined;
  for (const issue of all) {
    const body = String(issue.body ?? "");
    const metadata = taskMetadata(body);
    // Tasks published before feature branches are finished by hand.
    if (!metadata && body.includes("<!-- crewbie-task:")) continue;
    if (!metadata) throw new Error(`Managed issue #${issue.number} lacks task metadata.`);
    const number = integer(issue.number, "issue number");
    const claim = claims.has(number);
    const comments = await client.list(`/repos/${config.repository}/issues/${number}/comments`);
    const approved = await approvedIn(client, comments, config, issue);
    let pr = claim ? await linkedPull(client, config.repository, number, metadata.branch) : null;
    const restart = [...comments].reverse().find((comment) => String(comment.body ?? "").includes(RESTART_MARKER));
    // After a restart, an earlier closed, unmerged PR belongs to the ended attempt.
    if (pr && restart && pr.state === "closed" && !pr.merged_at && String(restart.created_at) > String(pr.created_at)) pr = null;
    let sessionComplete = false;
    let sessionEnded = false;
    let nativeTask: Record<string, unknown> | undefined;
    let state: WorkState = !approved ? "blocked" : claim ? "running" : "ready";
    let reason = !approved ? "Missing current human execution approval." : claim ? "Launch already claimed; awaiting or reconciling its session/PR." : "Approved; dependencies will be checked.";
    if (claim && !pr && copilotStartFailure(comments)) {
      state = "failed"; sessionEnded = true;
      reason = `Copilot reported it could not start this task; no session ran, so it does not count as a task attempt. Add the ${RESTART_LABEL} label to relaunch it.`;
    } else if (claim && !pr && !copilotAssigned(issue)) {
      state = "blocked"; reason = "Launch was claimed but neither Copilot assignment nor a linked PR is visible. Inspect the outcome before retrying.";
    }
    if (pr?.merged_at) { state = "done"; reason = `Merged into ${metadata.branch}.`; }
    else if (pr) {
      telemetry ??= cloudTasks(client, config.repository);
      const snapshot = await telemetry;
      const matches = snapshot.tasks.filter((task) => Array.isArray(task.artifacts) && task.artifacts.some((raw) => {
        const artifact = record(raw, "task artifact");
        return artifact.provider === "github" && artifact.type === "pull" && artifact.data !== undefined
          && typeof pr.id === "number" && record(artifact.data, "artifact data").id === pr.id;
      }));
      nativeTask = await pendingContinuation(client, comments, config, matches) ? undefined : await selectNativeTask(client, config, number, matches);
      sessionComplete = nativeTask?.state === "completed";
      const failed = nativeTask !== undefined && ["failed", "timed_out", "cancelled"].includes(String(nativeTask.state));
      // An open PR may still receive an authorized continuation, so only closure releases a failed session's slot.
      sessionEnded = failed && (pr.state === "closed" || issue.state === "closed");
      state = sessionComplete ? "review" : failed ? "failed" : "running";
      reason = sessionComplete ? "Cloud task completed; linked PR awaits human review."
        : failed ? `Cloud task ${String(nativeTask?.state)}; inspect its saved work before an explicitly authorized continuation.`
        : snapshot.warning ?? "Linked PR exists, but its cloud session is active or unverified; capacity remains reserved.";
    }
    if (!pr?.merged_at && (pr?.state === "closed" || issue.state === "closed")) {
      state = "failed";
      reason = `Closed without a merged prerequisite PR.${claim && !sessionComplete ? sessionEnded ? ` ${reason}` : ` Native completion remains unverified or unsuccessful; capacity stays reserved. ${reason}` : ""}`;
    }
    const role = config.roles.find((role) => role.id === metadata.task.owner);
    if (!claim && (!role || role.model !== metadata.task.model)) { state = "blocked"; reason = "Owner/model policy changed; reapproval required."; }
    if (!Array.isArray(issue.labels)) throw new Error("Issue labels are missing.");
    const ownerLabels = issue.labels.map((label) => typeof label === "string" ? label : String(record(label, "label").name))
      .filter((label) => label.startsWith("crewbie:owner:"));
    if (!claim && (ownerLabels.length !== 1 || ownerLabels[0] !== `crewbie:owner:${metadata.task.owner}`)) {
      state = "blocked"; reason = "Owner label does not match the approved specialist.";
    }
    if (!approved && state !== "failed") { state = "blocked"; reason = "Issue content no longer has current human execution approval."; }
    result.push({ issue, metadata, state, approved, claimed: claim, sessionComplete, ...(sessionEnded ? { sessionEnded } : {}), reason, ...(pr ? { pull: pr } : {}), ...(nativeTask ? { nativeTask } : {}) });
  }
  const key = (batch: string, digest: string, id: string) => `${batch}/${digest}/${id}`;
  const present = new Set(result.map((item) => key(item.metadata.batch, item.metadata.batchDigest, item.metadata.task.id)));
  const missing = new Set(result.flatMap((item) => item.metadata.task.dependsOn.map((id) => key(item.metadata.batch, item.metadata.batchDigest, id))).filter((id) => !present.has(id)));
  if (missing.size) {
    for (const issue of await managedIssues(client, config.repository, "closed")) {
      const metadata = taskMetadata(String(issue.body ?? ""));
      const id = metadata && key(metadata.batch, metadata.batchDigest, metadata.task.id);
      if (!metadata || !id || !missing.has(id)) continue;
      missing.delete(id);
      const merged = !!(await linkedPull(client, config.repository, integer(issue.number, "prerequisite issue"), metadata.branch))?.merged_at;
      result.push({ issue, metadata, state: merged ? "done" : "failed", approved: false, claimed: false, sessionComplete: false,
        reason: merged ? "Closed; linked Copilot PR merged." : "Closed without a merged prerequisite PR." });
      if (!missing.size) break;
    }
  }
  return result;
}
export function batchWork(work: Work[], batch: Batch): Work[] {
  requireApproval(batch);
  if (!batch.approval?.execute) throw new Error("Watching requires execution approval.");
  const digest = batchDigest(batch);
  const expected = new Set(batch.tasks.map((task) => task.id));
  const selected = work.filter((item) => item.metadata.batch === batch.id && item.metadata.batchDigest === digest && expected.has(item.metadata.task.id));
  if (selected.length !== batch.tasks.length) throw new Error(`Published batch is incomplete or duplicated (${selected.length} records for ${batch.tasks.length} tasks); reconcile before dispatch.`);
  for (const task of batch.tasks) {
    const matches = selected.filter((item) => item.metadata.task.id === task.id);
    const item = matches[0];
    if (matches.length !== 1 || !item || item.metadata.batchDigest !== digest || !item.approved
      || item.issue.title !== task.title || item.issue.body !== issueBody(batch, task)) {
      throw new Error(`Published task ${task.id} differs from the approved batch; stop for reconciliation.`);
    }
  }
  return selected;
}
export function eligible(work: Work[], maxActive: number, batchId?: string): Work[] {
  // Replanned batches reuse batch/task ids; the approved digest keeps each revision's graph separate.
  const keyOf = (item: Work, id = item.metadata.task.id) => `${item.metadata.batch}/${item.metadata.batchDigest}/${id}`;
  const byKey = new Map<string, Work>();
  for (const item of work) {
    const key = keyOf(item);
    if (byKey.has(key)) throw new Error(`Duplicate task ${item.metadata.batch}/${item.metadata.task.id}.`);
    byKey.set(key, item);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(item: Work): void {
    const key = keyOf(item);
    if (visiting.has(key)) throw new Error(`Dependency cycle at ${item.metadata.batch}/${item.metadata.task.id}.`);
    if (visited.has(key)) return;
    // Finished work no longer waits on anything, and its own prerequisites may not have been loaded.
    if (item.state === "done" || item.state === "failed") { visited.add(key); return; }
    visiting.add(key);
    for (const id of item.metadata.task.dependsOn) {
      const dependency = byKey.get(keyOf(item, id));
      if (!dependency) throw new Error(`Missing prerequisite ${id}.`);
      visit(dependency);
      // Review tasks, like every other task, start from the merged work on the feature branch.
      if (!item.claimed && dependency.state !== "done") { item.state = "blocked"; item.reason = `Waiting for ${id} to merge into ${item.metadata.branch}.`; }
    }
    visiting.delete(key); visited.add(key);
  }
  for (const item of work) visit(item);
  const active = work.filter((item) => item.claimed && item.state !== "done" && item.sessionComplete !== true && item.sessionEnded !== true).length;
  return work.filter((item) => item.approved && !item.claimed && item.state === "ready" && (batchId === undefined || item.metadata.batch === batchId))
    .sort((a, b) => a.metadata.task.priority - b.metadata.task.priority || a.metadata.task.id.localeCompare(b.metadata.task.id))
    .slice(0, Math.max(0, maxActive - active));
}
export async function dispatch(client: GitHubApi, config: Config, ado?: AdoApi, scope?: { batch?: Batch; issueNumbers: number[] }, discoverModels: DiscoverModels = listCopilotModels): Promise<Work[]> {
  return withDispatchLock(client, config, () => dispatchLocked(client, config, ado, scope, discoverModels));
}
async function dispatchLocked(client: GitHubApi, config: Config, ado: AdoApi | undefined, scope: { batch?: Batch; issueNumbers: number[] } | undefined, discoverModels: DiscoverModels): Promise<Work[]> {
  await ensureLabels(client, config);
  const work = await inspectWork(client, config, scope?.issueNumbers);
  const scoped = scope?.batch ? batchWork(work, scope.batch) : work;
  const selected = eligible(work, config.maxActive, scope?.batch?.id);
  for (const item of selected) {
    const allowance = await launchAllowance(client, config, item.metadata, integer(item.issue.number, "issue"));
    const blocked = allowance.blocked ?? (allowance.issueUsed > 0 ? "Initial launch already reserved; inspect its outcome instead of retrying." : null);
    if (blocked) { item.state = "blocked"; item.reason = blocked; }
  }
  const candidates = selected.filter((item) => item.state === "ready");
  // A model the cloud agent rejects blocks only its own tasks; the rest of the batch still launches.
  const rejected = candidates.length ? await rejectedLaunchModels(await discoverModels(), candidates.map((item) => item.metadata.task), config, client) : new Set<string>();
  for (const item of candidates) if (rejected.has(item.metadata.task.model)) { item.state = "blocked"; item.reason = modelRejection(item.metadata.task.model, item.metadata.task.owner); }
  const launchable = candidates.filter((item) => item.state === "ready");
  for (const item of scoped) {
    await setStatus(client, config.repository, item.issue, item.state);
    if (item.state === "review" && item.sessionComplete && item.pull && item.nativeTask?.custom_agent) {
      await attributePull(client, config, item.pull, item.nativeTask, item.metadata.task.owner, item.metadata.task.model, integer(item.issue.number, "execution issue"));
    }
    if (item.state === "review" && item.sessionComplete && item.pull?.state === "open") {
      try { item.reason = await afterSession(client, config, item); }
      catch (error) { item.reason = `Ready/review/merge step stopped: ${error instanceof Error ? error.message : "request failed"}`; }
    }
  }
  const repo = record(await client.request("GET", `/repos/${config.repository}`), "repository");
  const branch = string(repo.default_branch, "default branch");
  const branchInfo = record(await client.request("GET", `/repos/${config.repository}/branches/${encodeURIComponent(branch)}`), "branch");
  const sha = string(record(branchInfo.commit, "commit").sha, "base SHA");
  for (const item of launchable) {
    const issue = integer(item.issue.number, "issue number");
    let fresh: Record<string, unknown>;
    try {
      fresh = await freshLaunchable(client, config, item, sha, ado);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source verification failed.";
      if (!/Source changed|requirements changed/i.test(message)) throw error;
      item.state = "blocked";
      item.reason = `Source verification failed: ${message}`;
      await setStatus(client, config.repository, item.issue, "blocked");
      continue;
    }
    const allowance = await launchAllowance(client, config, item.metadata, issue);
    if (allowance.blocked) {
      item.state = "blocked"; item.reason = allowance.blocked;
      await setStatus(client, config.repository, fresh, "blocked");
      continue;
    }
    const base = await ensureBranch(client, config, item.metadata.branch, sha);
    await reserveLaunch(client, config, item.metadata, issue, sha, true);
    // Atomic remote claim prevents a second workflow from launching the same issue.
    await client.request("POST", `/repos/${config.repository}/git/refs`, { ref: `refs/tags/crewbie/claims/${issue}`, sha });
    await assign(client, config, item, fresh, base);
  }
  await restarts(client, config, work, sha, discoverModels, ado);
  await featurePulls(client, config, work, branch);
  return work;
}
/** Creates a plan's feature branch from the default branch the first time one of its tasks launches. */
async function ensureBranch(client: GitHubApi, config: Config, branch: string, sha: string): Promise<string> {
  // The git refs API takes the ref path with literal slashes; the branch name was validated as crewbie/<slug>.
  const path = `/repos/${config.repository}/git/ref/heads/${branch}`;
  try { await client.request("GET", path); return branch; }
  catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
  try { await client.request("POST", `/repos/${config.repository}/git/refs`, { ref: `refs/heads/${branch}`, sha }); }
  catch (error) { if (!(error instanceof GitHubError && error.status === 422)) throw error; await client.request("GET", path); }
  return branch;
}
export const FEATURE_MARKER = "<!-- crewbie-feature:";
const FEATURE_TASKS_START = "<!-- crewbie-feature-tasks:start -->";
const FEATURE_TASKS_END = "<!-- crewbie-feature-tasks:end -->";
/**
 * Once every task of a feature plan merged into its branch, Crewbie opens one PR to the default branch that closes all of
 * the plan's issues. The Crewbie reviewer (when enabled) reviews each new head; only a human merges it.
 */
async function featurePulls(client: GitHubApi, config: Config, work: Work[], base: string): Promise<void> {
  const prefix = `/repos/${config.repository}`;
  const plans = new Map<string, Work[]>();
  for (const item of work) {
    const key = `${item.metadata.batch}/${item.metadata.batchDigest}`;
    plans.set(key, [...plans.get(key) ?? [], item]);
  }
  for (const items of plans.values()) {
    if (items.some((item) => item.state !== "done")) continue;
    const { batch, branch } = items[0]!.metadata;
    const owner = config.repository.split("/")[0]!;
    const pulls = (await client.list(`${prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}`))
      .sort((a, b) => integer(b.number, "PR") - integer(a.number, "PR"));
    let feature = pulls.find((pr) => pr.state === "open" || pr.merged_at);
    let note: string;
    if (feature?.merged_at) note = `Feature PR #${String(feature.number)} merged into ${base}.`;
    else if (!feature && pulls.length) note = `Feature PR #${String(pulls[0]!.number)} was closed without merging; reopen it to continue.`;
    else {
      let opened = "";
      if (!feature) {
        try {
          feature = record(await client.request("POST", `${prefix}/pulls`, { title: await featureTitle(client, config, batch), head: branch, base, body: featureBody(config, batch, branch, items) }), "feature PR");
          opened = `Opened feature PR #${String(feature.number)}. `;
        } catch (error) {
          if (error instanceof GitHubError && error.status === 422) { note = `${branch} has nothing to merge into ${base}, or GitHub refused the feature PR.`; setNote(items, branch, note); continue; }
          throw error;
        }
      } else {
        const current = typeof feature.body === "string" ? feature.body : "";
        const body = updateFeatureBody(config, batch, items, current);
        if (feature.state === "open" && body !== current) {
          feature = record(await client.request("PATCH", `${prefix}/pulls/${integer(feature.number, "feature PR")}`, { body }), "feature PR");
        }
      }
      note = opened + await featureReview(client, config, feature, branch);
    }
    setNote(items, branch, note);
  }
}
function setNote(items: Work[], branch: string, note: string): void { for (const item of items) item.reason = `Merged into ${branch}. ${note}`; }
async function featureTitle(client: GitHubApi, config: Config, batch: string): Promise<string> {
  const source = /^issue-(\d+)$/.exec(batch)?.[1];
  if (source) {
    try { return `Crewbie feature: ${string(record(await client.request("GET", `/repos/${config.repository}/issues/${source}`), "source issue").title, "source title")} (#${source})`; }
    catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
  }
  return `Crewbie feature: ${batch}`;
}
export function featureBody(config: Config, batch: string, branch: string, items: FeatureBodyItem[]): string {
  const reviewer = reviewerFor(config);
  return [
    `Every task of plan \`${batch}\` merged into \`${branch}\`. Check out that branch to test the whole feature, then merge this PR yourself; Crewbie never merges it.${reviewer ? ` crewbie-${reviewer.role} reviews each new head.` : ""} Comment \`/crewbie fix\` to have the specialists address a changes-requested review.`,
    "", managedFeatureBlock(config, items),
    "", `${FEATURE_MARKER}${batch} -->`,
  ].join("\n");
}
function managedFeatureBlock(config: Config, items: FeatureBodyItem[]): string {
  const sorted = [...items].sort((a, b) => integer(a.issue.number, "issue") - integer(b.issue.number, "issue"));
  return [
    FEATURE_TASKS_START,
    "## Tasks",
    ...sorted.map((item) => `- #${String(item.issue.number)} ${String(item.issue.title)}${item.pull ? ` (#${String(item.pull.number)})` : ""}`),
    "", ...sorted.map((item) => `Closes #${String(item.issue.number)}`),
    ...sourceIssues(config, items).map((number) => `Closes #${String(number)}`),
    FEATURE_TASKS_END,
  ].join("\n");
}
function taskIssueSet(items: FeatureBodyItem[]): Set<number> {
  return new Set(items.map((item) => integer(item.issue.number, "issue")));
}
function bodyCloses(body: string): Set<number> {
  return new Set([...body.matchAll(/\bCloses\s+#(\d+)\b/gi)].map((match) => Number(match[1])));
}
function hasManagedTaskSet(body: string, items: FeatureBodyItem[]): boolean {
  const closes = bodyCloses(body);
  for (const issue of taskIssueSet(items)) if (!closes.has(issue)) return false;
  return true;
}
export function updateFeatureBody(config: Config, batch: string, items: FeatureBodyItem[], current: string): string {
  if (hasManagedTaskSet(current, items)) return current;
  const block = managedFeatureBlock(config, items);
  const start = current.indexOf(FEATURE_TASKS_START), end = current.indexOf(FEATURE_TASKS_END);
  if (start >= 0 && end > start) return `${current.slice(0, start)}${block}${current.slice(end + FEATURE_TASKS_END.length)}`;
  const missing = [...taskIssueSet(items)].filter((issue) => !bodyCloses(current).has(issue)).sort((a, b) => a - b).map((issue) => `Closes #${issue}`);
  const addition = missing.length ? `\n${missing.join("\n")}` : "";
  const marker = `${FEATURE_MARKER}${batch} -->`;
  const index = current.indexOf(marker);
  if (index >= 0) return `${current.slice(0, index).trimEnd()}${addition}\n\n${current.slice(index)}`;
  return `${current.trimEnd()}${addition}\n\n${marker}`;
}
function sourceIssues(config: Config, items: FeatureBodyItem[]): number[] {
  const prefix = `https://github.com/${config.repository}/issues/`;
  const tasks = new Set(items.map((item) => integer(item.issue.number, "issue")));
  const numbers = items.flatMap((item) => item.metadata.sources.map((source) => source.uri))
    .filter((uri) => uri.startsWith(prefix) && /^\d+$/.test(uri.slice(prefix.length))).map((uri) => Number(uri.slice(prefix.length)));
  return [...new Set(numbers)].filter((number) => !tasks.has(number)).sort((a, b) => a - b);
}
async function featureReview(client: GitHubApi, config: Config, pull: Record<string, unknown>, branch: string): Promise<string> {
  const number = integer(pull.number, "feature PR");
  const reviewer = reviewerFor(config);
  const human = `Test ${branch}, then merge feature PR #${number} yourself.`;
  if (!reviewer) return human;
  const head = string(record(pull.head, "feature PR head").sha, "feature PR head SHA");
  const review = await trustedReview(client, config, number, head);
  if (!review) return `${await requestReview(client, config, number, head)} ${human}`;
  if (review.verdict === "changes") return `crewbie-${reviewer.role} requested changes on ${head.slice(0, 7)}; push fixes to ${branch} for a fresh review, or merge feature PR #${number} yourself if you disagree.`;
  return `crewbie-${reviewer.role} found no blocking issues on ${head.slice(0, 7)}${review.partial ? " (partial review)" : ""}. ${human}`;
}
function labelsOf(issue: Record<string, unknown>): string[] {
  if (!Array.isArray(issue.labels)) throw new Error("Issue labels are missing.");
  return issue.labels.map((label) => typeof label === "string" ? label : String(record(label, "label").name));
}
const activeSessions = (work: Work[]) => work.filter((other) => other.claimed && other.state !== "done" && other.sessionComplete !== true && other.sessionEnded !== true).length;
/** After a completed session Crewbie marks the task PR ready and merges it into its feature branch once every check passed. */
async function afterSession(client: GitHubApi, config: Config, item: Work): Promise<string> {
  const pull = item.pull!;
  const lead = await markReady(client, pull) ? "Crewbie marked the PR ready for review. " : "";
  // Copilot asks the assigning person to review every finished PR; task PRs merge without one, so only the feature PR asks.
  const people = (Array.isArray(pull.requested_reviewers) ? pull.requested_reviewers : []).map((user) => String(record(user, "requested reviewer").login));
  if (people.length) await client.request("DELETE", `/repos/${config.repository}/pulls/${integer(pull.number, "PR number")}/requested_reviewers`, { reviewers: people });
  const outcome = await autoMerge(client, config, integer(pull.number, "PR number"), string(record(pull.head, "PR head").sha, "PR head SHA"));
  if (outcome.merged) { item.state = "done"; await setStatus(client, config.repository, item.issue, "done"); }
  return lead + outcome.reason;
}
async function freshLaunchable(client: GitHubApi, config: Config, item: Work, sha: string, ado?: AdoApi): Promise<Record<string, unknown>> {
  const issue = integer(item.issue.number, "issue number");
  await verifySources(item.metadata.sources, client, config, ado);
  const fresh = record(await client.request("GET", `/repos/${config.repository}/issues/${issue}`), "current issue");
  if (fresh.body !== item.issue.body || fresh.title !== item.issue.title || fresh.state !== "open" || !await hasApproval(client, config, fresh)) {
    throw new Error(`Issue #${issue} changed during dispatch. Nothing was launched for this issue.`);
  }
  await client.request("GET", `/repos/${config.repository}/contents/.github/agents/crewbie-${item.metadata.task.owner}.agent.md?ref=${sha}`);
  return fresh;
}
async function assign(client: GitHubApi, config: Config, item: Work, fresh: Record<string, unknown>, branch: string): Promise<void> {
  const issue = integer(fresh.number, "issue number");
  const task = item.metadata.task;
  try {
    const assigned = record(await client.request("POST", `/repos/${config.repository}/issues/${issue}/assignees`, {
      assignees: ["copilot-swe-agent[bot]"],
      agent_assignment: {
        target_repo: config.repository, base_branch: branch, custom_agent: `crewbie-${task.owner}`, model: task.model,
        custom_instructions: `Implement only issue #${issue}. Approved task fingerprint: ${hash(String(fresh.body))}. If the issue changes from this approved scope, stop for reapproval. Approved task:\n${task.body}\nRead your Crewbie charter, shared working rules, configured constitution, shared decisions, hot memory and index first. Link the PR with Closes #${issue}. Identify Specialist: crewbie-${task.owner} in the PR description. Report the memory paths/revisions read. Before handoff, add only non-obvious gotchas (one or two lines each, with a link) to .crewbie/team/${task.owner}/hot.md on this branch, as the shared working rules describe; this is always in scope. Put downstream contracts in the PR Handoff section, not memory. Keep the PR concise, with ## What changed, ## Why and ## Checks sections (actual checks and risks). Requested model: ${task.model}; report observed model only with runtime evidence.`,
      },
    }), "assignment response");
    if (!copilotAssigned(assigned)) throw new Error("GitHub did not confirm Copilot among the assignees. The assignment may have been ignored; check push access and cloud-agent entitlement.");
    if (assigned.number !== issue || assigned.title !== fresh.title || assigned.body !== fresh.body) throw new Error("Issue scope changed during assignment. Inspect the session and obtain reapproval.");
    item.state = "running"; item.claimed = true; item.reason = "Assignment requested; effective profile/model remain subject to runtime verification.";
    await setStatus(client, config.repository, fresh, "running");
  } catch (error) {
    throw new Error(`Issue #${issue} has a persistent launch claim. Assignment outcome may be unknown; inspect GitHub before any manual retry. ${error instanceof Error ? error.message : "Request failed."}`);
  }
}
/** Why a restart request cannot relaunch this task, or null when its previous session verifiably ended. */
export function restartProblem(item: Work): string | null {
  if (item.issue.state !== "open") return "the issue is closed. Reopen it first if the work is still wanted.";
  if (!item.approved) return "the issue no longer has current human execution approval.";
  if (!item.claimed) return "it was never launched; dispatch starts it when it is ready.";
  if (item.pull?.merged_at) return "its PR is already merged.";
  if (item.pull?.state === "open") return "it has an open PR. Push fixes to it, or close it and add the label again.";
  if (item.sessionEnded !== true) return "its previous session is not verified as ended, so a relaunch could run twice.";
  return null;
}
async function restarts(client: GitHubApi, config: Config, work: Work[], sha: string, discoverModels: DiscoverModels, ado?: AdoApi): Promise<void> {
  const prefix = `/repos/${config.repository}`;
  for (const item of work.filter((item) => labelsOf(item.issue).includes(RESTART_LABEL))) {
    const issue = integer(item.issue.number, "issue number");
    const consume = async (message: string) => {
      await client.request("DELETE", `${prefix}/issues/${issue}/labels/${encodeURIComponent(RESTART_LABEL)}`);
      await client.request("POST", `${prefix}/issues/${issue}/comments`, { body: message });
    };
    const events = await client.list(`${prefix}/issues/${issue}/events`);
    const labeled = [...events].reverse().find((event) => event.event === "labeled" && event.label !== null && event.label !== undefined
      && record(event.label, "label").name === RESTART_LABEL);
    if (!labeled || !await isWriter(client, config.repository, labeled.actor)) {
      item.reason = "Restart refused: the label was not applied by a user with write access.";
      await consume(`Crewbie did not restart this task: the \`${RESTART_LABEL}\` label must be applied by a user with write access.`);
      continue;
    }
    const problem = restartProblem(item);
    if (problem) {
      item.reason = `Restart refused: ${problem}`;
      await consume(`Crewbie did not restart this task: ${problem}`);
      continue;
    }
    const active = activeSessions(work);
    if (active >= config.maxActive) { item.reason = `Restart requested; waiting for a free session slot (${active}/${config.maxActive}).`; continue; }
    const allowance = await launchAllowance(client, config, item.metadata, issue);
    if (allowance.blocked) {
      item.reason = `Restart refused: ${allowance.blocked}`;
      await consume(`Crewbie did not restart this task: ${allowance.blocked}`);
      continue;
    }
    await checkLaunchModels(await discoverModels(), [item.metadata.task], config, client);
    const fresh = await freshLaunchable(client, config, item, sha, ado);
    // Copilot starts on a new assignment event; an earlier assignment from the ended attempt would suppress it.
    // The API shows the bot as "Copilot" but only removes it by its account login.
    if (copilotAssigned(fresh)) {
      const after = record(await client.request("DELETE", `${prefix}/issues/${issue}/assignees`, { assignees: ["copilot-swe-agent[bot]"] }), "unassign response");
      if (copilotAssigned(after)) throw new Error(`Issue #${issue}: GitHub did not remove the earlier Copilot assignment, so a new one would not start a session. No attempt was used; unassign Copilot, then run dispatch again.`);
    }
    const reserved = await reserveLaunch(client, config, item.metadata, issue, sha);
    await client.request("DELETE", `${prefix}/issues/${issue}/labels/${encodeURIComponent(RESTART_LABEL)}`);
    await client.request("POST", `${prefix}/issues/${issue}/comments`, {
      body: `Crewbie restart requested by @${String(record(labeled.actor, "actor").login)}: attempt ${reserved.taskUsed + 1} of ${reserved.maxAttemptsPerTask} for this task. The previous session had ended.\n${RESTART_MARKER}${reserved.taskUsed + 1} -->`,
    });
    item.sessionEnded = false;
    await assign(client, config, item, { ...fresh, assignees: [] }, await ensureBranch(client, config, item.metadata.branch, sha));
  }
}
export async function preflight(client: GitHubApi, config: Config, batchId?: string, discoverModels: DiscoverModels = listCopilotModels, ado?: AdoApi) {
  const work = await inspectWork(client, config);
  const candidates = eligible(work, config.maxActive, batchId);
  const models = candidates.length ? await discoverModels() : [];
  const prefix = `/repos/${config.repository}`;
  const repo = record(await client.request("GET", prefix), "repository");
  const branch = string(repo.default_branch, "default branch");
  const pending = new Map<string, number>();
  const tasks = [];
  for (const item of work.filter((item) => !batchId || item.metadata.batch === batchId)) {
    const issue = integer(item.issue.number, "issue");
    const allowance = await launchAllowance(client, config, item.metadata, issue);
    let reason = allowance.blocked ?? item.reason;
    let ready = candidates.includes(item) && !allowance.blocked;
    if (ready && allowance.issueUsed > 0) { ready = false; reason = "Initial launch already reserved; inspect its outcome instead of retrying."; }
    let profileRevision: string | null = null;
    if (ready) {
      await checkLaunchModels(models, [item.metadata.task], config);
      await verifySources(item.metadata.sources, client, config, ado);
      const profile = record(await client.request("GET", `${prefix}/contents/.github/agents/crewbie-${item.metadata.task.owner}.agent.md?ref=${encodeURIComponent(branch)}`), "specialist profile");
      if (profile.type !== "file") throw new Error("Specialist profile is not a regular file.");
      profileRevision = string(profile.sha, "specialist profile revision");
      const queued = pending.get(allowance.batch) ?? 0;
      if (allowance.used + queued >= allowance.maxLaunchesPerBatch) { ready = false; reason = "Batch allowance is reserved by earlier candidates in this preview."; }
      else { pending.set(allowance.batch, queued + 1); reason = "Current approval, dependencies, source and account model verified; cloud runtime acceptance remains unverified."; }
    } else if (item.state === "ready" && !candidates.includes(item) && !allowance.blocked) reason = "Waiting for repository capacity.";
    tasks.push({ issue, title: item.metadata.task.title, specialist: `crewbie-${item.metadata.task.owner}`, model: item.metadata.task.model,
      approved: item.approved, ready, reason, profileRevision, allowance });
  }
  return { repository: config.repository, branch, tasks, notice: "Read-only snapshot; launch rechecks policy and reserves allowance under the repository lock. No session started. Account catalog availability does not prove cloud-runtime acceptance." };
}
