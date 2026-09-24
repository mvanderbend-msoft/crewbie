import { type Config } from "../config.js";
import { hash, integer, record, string } from "../core.js";
import { GitHubError } from "./github.js";
import { batchDigest, issueBody, requireApproval, taskMetadata, type Batch } from "../specification/batch.js";
import { isApprover, type GitHubApi } from "../tracking/github.js";
import { ensureLabels, hasApproval, managedIssues, setStatus } from "../tracking/issues.js";
import { verifySources } from "../tracking/sources.js";
import type { AdoApi } from "../tracking/ado.js";
import { attributePull } from "./attribution.js";
import { cloudTasks } from "../tracking/native.js";
import { checkLaunchModels, launchAllowance, listCopilotModels, reserveLaunch, withDispatchLock, type DiscoverModels } from "./controls.js";
export { withDispatchLock } from "./controls.js";

export type WorkState = "blocked" | "ready" | "running" | "review" | "failed" | "done";
export interface Work {
  issue: Record<string, unknown>;
  metadata: NonNullable<ReturnType<typeof taskMetadata>>;
  state: WorkState;
  approved: boolean;
  claimed: boolean;
  sessionComplete?: boolean;
  reason: string;
  pull?: Record<string, unknown>;
  nativeTask?: Record<string, unknown>;
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
    if (!isApprover(comment.user, config.approvers) || comment.created_at !== comment.updated_at) continue;
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
function copilotAssigned(issue: Record<string, unknown>): boolean {
  return Array.isArray(issue.assignees) && issue.assignees.some((value) => {
    const assignee = record(value, "assignee");
    return ["copilot-swe-agent[bot]", "copilot-swe-agent", "Copilot"].includes(String(assignee.login));
  });
}
async function claimed(client: GitHubApi, repo: string, number: number): Promise<boolean> {
  try { await client.request("GET", `/repos/${repo}/git/ref/tags/crewbie/claims/${number}`); return true; }
  catch (error) { if (error instanceof GitHubError && error.status === 404) return false; throw error; }
}
export async function linkedPull(client: GitHubApi, repository: string, issue: number): Promise<Record<string, unknown> | null> {
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
      if (pr.user === null) continue;
      const user = record(pr.user, "PR author");
      if (["copilot-swe-agent[bot]", "copilot-swe-agent", "Copilot"].includes(String(user.login))) pulls.push(pr);
    }
    const info = record(connection.pageInfo, "closing reference page");
    if (typeof info.hasNextPage !== "boolean") throw new Error("Closing-reference pagination is unverified.");
    if (!info.hasNextPage) break;
    const next = string(info.endCursor, "closing reference cursor");
    if (next === after || page === 99) throw new Error("Closing-reference pagination could not complete safely.");
    after = next;
  }
  if (pulls.length > 1) throw new Error(`Issue #${issue} has multiple candidate agent PRs. Reconcile before dispatch.`);
  return pulls[0] ?? null;
}
export async function inspectWork(client: GitHubApi, config: Config, knownIssues: readonly number[] = []): Promise<Work[]> {
  const all = await managedIssues(client, config.repository);
  const required = new Set(knownIssues.map((number) => integer(number, "published issue number")));
  const refs = await client.request("GET", `/repos/${config.repository}/git/matching-refs/tags/crewbie/claims/`);
  if (!Array.isArray(refs)) throw new Error("GitHub returned an invalid claim ledger.");
  for (const raw of refs) {
    const ref = string(record(raw, "claim ref").ref, "claim name");
    const match = /^refs\/tags\/crewbie\/claims\/(\d+)$/.exec(ref);
    if (!match) throw new Error(`Unexpected claim ref: ${ref}`);
    required.add(integer(Number(match[1]), "claimed issue number"));
  }
  for (const number of required) {
    if (!all.some((issue) => issue.number === number)) {
      all.push(record(await client.request("GET", `/repos/${config.repository}/issues/${number}`), "claimed issue"));
    }
  }
  const result: Work[] = [];
  let telemetry: ReturnType<typeof cloudTasks> | undefined;
  for (const issue of all) {
    const metadata = taskMetadata(String(issue.body ?? ""));
    if (!metadata) throw new Error(`Managed issue #${issue.number} lacks task metadata.`);
    const approved = await hasApproval(client, config, issue);
    const number = integer(issue.number, "issue number");
    const claim = await claimed(client, config.repository, number);
    const pr = claim ? await linkedPull(client, config.repository, number) : null;
    let sessionComplete = false;
    let nativeTask: Record<string, unknown> | undefined;
    let state: WorkState = !approved ? "blocked" : claim ? "running" : "ready";
    let reason = !approved ? "Missing current human execution approval." : claim ? "Launch already claimed; awaiting or reconciling its session/PR." : "Approved; dependencies will be checked.";
    if (claim && !pr && !copilotAssigned(issue)) {
      state = "blocked"; reason = "Launch was claimed but neither Copilot assignment nor a linked PR is visible. Inspect the outcome before retrying.";
    }
    if (pr?.merged_at) { state = "done"; reason = "Linked Copilot PR merged."; }
    else if (pr) {
      telemetry ??= cloudTasks(client, config.repository);
      const snapshot = await telemetry;
      const matches = snapshot.tasks.filter((task) => Array.isArray(task.artifacts) && task.artifacts.some((raw) => {
        const artifact = record(raw, "task artifact");
        return artifact.provider === "github" && artifact.type === "pull" && artifact.data !== undefined
          && typeof pr.id === "number" && record(artifact.data, "artifact data").id === pr.id;
      }));
      nativeTask = await selectNativeTask(client, config, number, matches);
      sessionComplete = nativeTask?.state === "completed";
      const failed = nativeTask !== undefined && ["failed", "timed_out", "cancelled"].includes(String(nativeTask.state));
      state = sessionComplete ? "review" : failed ? "failed" : "running";
      reason = sessionComplete ? "Cloud task completed; linked PR awaits human review."
        : failed ? `Cloud task ${String(nativeTask?.state)}; inspect its saved work before an explicitly authorized continuation.`
        : snapshot.warning ?? "Linked PR exists, but its cloud session is active or unverified; capacity remains reserved.";
    }
    if (!pr?.merged_at && (pr?.state === "closed" || issue.state === "closed")) {
      state = "failed";
      reason = `Closed without a merged prerequisite PR.${claim && !sessionComplete ? ` Native completion remains unverified or unsuccessful; capacity stays reserved. ${reason}` : ""}`;
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
    result.push({ issue, metadata, state, approved, claimed: claim, sessionComplete, reason, ...(pr ? { pull: pr } : {}), ...(nativeTask ? { nativeTask } : {}) });
  }
  return result;
}
export function batchWork(work: Work[], batch: Batch): Work[] {
  requireApproval(batch);
  if (!batch.approval?.execute) throw new Error("Watching requires execution approval.");
  const digest = batchDigest(batch);
  const selected = work.filter((item) => item.metadata.batch === batch.id && item.metadata.batchDigest === digest);
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
    visiting.add(key);
    for (const id of item.metadata.task.dependsOn) {
      const dependency = byKey.get(keyOf(item, id));
      if (!dependency) throw new Error(`Missing prerequisite ${id}.`);
      visit(dependency);
      const ready = dependency.state === "done" || (item.metadata.task.kind === "review" && dependency.state === "review" && dependency.sessionComplete === true);
      if (!item.claimed && item.state !== "failed" && item.state !== "done" && !ready) {
        item.state = "blocked";
        item.reason = item.metadata.task.kind === "review" ? `Waiting for ${id} to complete its cloud session and expose a reviewable PR.` : `Waiting for ${id} to merge.`;
      }
    }
    visiting.delete(key); visited.add(key);
  }
  for (const item of work) visit(item);
  const active = work.filter((item) => item.claimed && item.state !== "done" && item.sessionComplete !== true).length;
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
  const launchable = selected.filter((item) => item.state === "ready");
  if (launchable.length) await checkLaunchModels(await discoverModels(), launchable.map((item) => item.metadata.task), config);
  for (const item of scoped) {
    await setStatus(client, config.repository, item.issue, item.state);
    if (item.state === "review" && item.sessionComplete && item.pull && item.nativeTask?.custom_agent) {
      await attributePull(client, config, item.pull, item.nativeTask, item.metadata.task.owner, item.metadata.task.model, integer(item.issue.number, "execution issue"));
    }
  }
  const repo = record(await client.request("GET", `/repos/${config.repository}`), "repository");
  const branch = string(repo.default_branch, "default branch");
  const branchInfo = record(await client.request("GET", `/repos/${config.repository}/branches/${encodeURIComponent(branch)}`), "branch");
  const sha = string(record(branchInfo.commit, "commit").sha, "base SHA");
  for (const item of launchable) {
    const issue = integer(item.issue.number, "issue number");
    const task = item.metadata.task;
    await verifySources(item.metadata.sources, client, config, ado);
    const fresh = record(await client.request("GET", `/repos/${config.repository}/issues/${issue}`), "current issue");
    if (fresh.body !== item.issue.body || fresh.title !== item.issue.title || fresh.state !== "open" || !await hasApproval(client, config, fresh)) {
      throw new Error(`Issue #${issue} changed during dispatch. Nothing was launched for this issue.`);
    }
    await client.request("GET", `/repos/${config.repository}/contents/.github/agents/crewbie-${task.owner}.agent.md?ref=${sha}`);
    const allowance = await launchAllowance(client, config, item.metadata, issue);
    if (allowance.blocked) {
      item.state = "blocked"; item.reason = allowance.blocked;
      await setStatus(client, config.repository, fresh, "blocked");
      continue;
    }
    await reserveLaunch(client, config, item.metadata, issue, sha, true);
    // Atomic remote claim prevents a second workflow from launching the same issue.
    await client.request("POST", `/repos/${config.repository}/git/refs`, { ref: `refs/tags/crewbie/claims/${issue}`, sha });
    try {
      const assigned = record(await client.request("POST", `/repos/${config.repository}/issues/${issue}/assignees`, {
        assignees: ["copilot-swe-agent[bot]"],
        agent_assignment: {
          target_repo: config.repository, base_branch: branch, custom_agent: `crewbie-${task.owner}`, model: task.model,
          custom_instructions: `Implement only issue #${issue}. Approved task fingerprint: ${hash(String(fresh.body))}. If the issue changes from this approved scope, stop for reapproval. Approved task:\n${task.body}\nRead your Crewbie charter, shared working rules, configured constitution, shared decisions, hot memory and index first. Link the PR with Closes #${issue}. Identify Specialist: crewbie-${task.owner} in the PR description. Report the memory paths/revisions read. Before handoff, add only non-obvious gotchas (one or two lines each, with a link) to .crewbie/team/${task.owner}/hot.md on this branch, as the shared working rules describe; this is always in scope. Put downstream contracts in the PR Handoff section, not memory. Keep the PR concise: what, why, actual checks and risks. Requested model: ${task.model}; report observed model only with runtime evidence.`,
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
  return work;
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
