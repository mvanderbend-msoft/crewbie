import { DEFAULT_EXECUTION_LIMITS, requireExecution, type Config } from "../config.js";
import { GitHubError, integer, record, slug, string } from "../core.js";
import { taskMetadata } from "../specification/batch.js";
import { requireApprover, type GitHubApi } from "../tracking/github.js";
import { listCopilotModels, type ModelChoice } from "../setup/copilot.js";

type Metadata = NonNullable<ReturnType<typeof taskMetadata>>;
export type DiscoverModels = () => Promise<ModelChoice[]>;
export { listCopilotModels };
const PAUSE = "tags/crewbie/paused";

export { RESTART_LABEL } from "../config.js";
export const RESTART_MARKER = "<!-- crewbie-restart:";
function isStartFailure(comment: Record<string, unknown>): boolean {
  const user = comment.user === null || comment.user === undefined ? {} : record(comment.user, "comment author");
  return user.type === "Bot" && ["Copilot", "copilot-swe-agent[bot]", "copilot-swe-agent"].includes(String(user.login))
    && /unable to start working on this issue/i.test(String(comment.body ?? ""));
}
/** Comments after the latest Crewbie restart marker. A forged marker only hides a start failure, which keeps capacity reserved. */
export function sinceRestart(comments: Record<string, unknown>[]): Record<string, unknown>[] {
  let start = 0;
  comments.forEach((comment, index) => { if (String(comment.body ?? "").includes(RESTART_MARKER)) start = index + 1; });
  return comments.slice(start);
}
/** Copilot reported that the current launch (since the latest restart) could not start. */
export function copilotStartFailure(comments: Record<string, unknown>[]): boolean {
  return sinceRestart(comments).some(isStartFailure);
}
export function copilotStartFailures(comments: Record<string, unknown>[]): number {
  return comments.filter(isStartFailure).length;
}

const LOCK_REF = "tags/crewbie/dispatch-lock";
export const LOCK_WAIT = { attempts: 60, delayMs: 5_000 };

export async function withDispatchLock<T>(client: GitHubApi, config: Config, action: () => Promise<T>): Promise<T> {
  requireExecution(config);
  const sha = await defaultHead(client, config);
  const prefix = `/repos/${config.repository}`;
  // Dispatch and plan-release workflows both fire on a planning merge; wait for the short-lived holder instead of failing.
  for (let attempt = 1; ; attempt++) {
    try { await client.request("POST", `${prefix}/git/refs`, { ref: `refs/${LOCK_REF}`, sha }); break; }
    catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
      if (attempt >= LOCK_WAIT.attempts) {
        throw new Error(`Another Crewbie run still holds refs/${LOCK_REF} after ${Math.round(LOCK_WAIT.attempts * LOCK_WAIT.delayMs / 1000)}s. Nothing was launched. If no Crewbie workflow is running, delete that tag and rerun this workflow.`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT.delayMs));
    }
  }
  try { return await action(); }
  finally { await client.request("DELETE", `${prefix}/git/refs/${LOCK_REF}`); }
}
async function defaultHead(client: GitHubApi, config: Config): Promise<string> {
  const prefix = `/repos/${config.repository}`;
  const repo = record(await client.request("GET", prefix), "repository");
  const branch = string(repo.default_branch, "default branch");
  const current = record(await client.request("GET", `${prefix}/branches/${encodeURIComponent(branch)}`), "branch");
  return string(record(current.commit, "commit").sha, "base commit");
}
export async function launchesPaused(client: GitHubApi, config: Config): Promise<boolean> {
  try { await client.request("GET", `/repos/${config.repository}/git/ref/${PAUSE}`); return true; }
  catch (error) { if (error instanceof GitHubError && error.status === 404) return false; throw error; }
}
export async function setLaunchPause(client: GitHubApi, config: Config, paused: boolean, apply: boolean): Promise<string> {
  if (!apply) return `Preview: ${paused ? "pause" : "resume"} future Crewbie implementation/review launches repository-wide. Running sessions are not stopped; allowances and approvals are not reset. Repeat with --apply.`;
  await requireApprover(client, config.approvers);
  return withDispatchLock(client, config, async () => {
    if (await launchesPaused(client, config) !== paused) {
      if (paused) await client.request("POST", `/repos/${config.repository}/git/refs`, { ref: `refs/${PAUSE}`, sha: await defaultHead(client, config) });
      else await client.request("DELETE", `/repos/${config.repository}/git/refs/${PAUSE}`);
    }
    return `${paused ? "Paused" : "Resumed"} future Crewbie launches. Running sessions, launch allowances and approvals are unchanged. No agents were started.`;
  });
}
export interface LaunchAllowance {
  batch: string; task: string; issue: number; used: number; taskUsed: number; issueUsed: number;
  maxLaunchesPerBatch: number; maxAttemptsPerTask: number; blocked: string | null;
}
export async function launchAllowance(client: GitHubApi, config: Config, metadata: Metadata, issue: number): Promise<LaunchAllowance> {
  const batch = slug(metadata.batch, "batch"), task = slug(metadata.task.id, "task");
  integer(issue, "issue");
  const prefix = `/repos/${config.repository}`;
  const refs = await client.list(`${prefix}/git/matching-refs/tags/crewbie/launches/${batch}/`);
  const entries = [];
  for (const raw of refs) {
    const ref = string(raw.ref, "launch ref");
    const match = /^refs\/tags\/crewbie\/launches\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63})\/(\d+)\/(\d+|baseline)$/.exec(ref);
    if (!match || match[1] !== batch) throw new Error("Invalid launch ledger; do not reset it to bypass limits.");
    const issue = integer(Number(match[3]), "ledger issue");
    let attempts = 1;
    if (match[4] === "baseline") {
      const object = record(raw.object, "baseline object");
      if (object.type !== "tag" || !/^[a-f0-9]{40}$/.test(String(object.sha))) throw new Error("Invalid historical launch baseline.");
      const tag = record(await client.request("GET", `${prefix}/git/tags/${object.sha}`), "baseline tag");
      const baseline = record(JSON.parse(string(tag.message, "baseline record")) as unknown, "historical baseline");
      if (baseline.schemaVersion !== 1 || baseline.batch !== batch || baseline.task !== match[2] || baseline.issue !== issue) throw new Error("Historical baseline does not match its launch ref.");
      attempts = integer(baseline.attempts, "historical attempts", 1, 10000);
    } else integer(Number(match[4]), "ledger attempt");
    entries.push({ ref, task: match[2]!, issue, attempts, baseline: match[4] === "baseline" });
  }
  if (new Set(entries.map((entry) => entry.ref)).size !== entries.length) throw new Error("Duplicate launch-ledger entries.");
  // Each launch Copilot reports it could not start ran no session, so it is not an attempt.
  for (const number of new Set(entries.filter((entry) => !entry.baseline).map((entry) => entry.issue))) {
    let refunds = copilotStartFailures(await client.list(`${prefix}/issues/${number}/comments`));
    for (const entry of entries) {
      if (refunds <= 0) break;
      if (entry.baseline || entry.issue !== number) continue;
      entry.attempts = 0; refunds--;
    }
  }
  const limits = config.execution ?? DEFAULT_EXECUTION_LIMITS;
  const result: LaunchAllowance = { batch, task, issue, used: entries.reduce((n, entry) => n + entry.attempts, 0),
    taskUsed: entries.filter((entry) => entry.task === task).reduce((n, entry) => n + entry.attempts, 0),
    issueUsed: entries.filter((entry) => entry.task === task && entry.issue === issue).reduce((n, entry) => n + entry.attempts, 0), ...limits, blocked: null };
  if (await launchesPaused(client, config)) result.blocked = "Future Crewbie launches are paused. Running sessions are unchanged.";
  else if (result.used >= limits.maxLaunchesPerBatch) result.blocked = `Batch launch allowance exhausted (${result.used}/${limits.maxLaunchesPerBatch}).`;
  else if (result.taskUsed >= limits.maxAttemptsPerTask) result.blocked = `Task attempt allowance exhausted (${result.taskUsed}/${limits.maxAttemptsPerTask}); initial and uncertain requests count; verified start failures do not.`;
  if (result.blocked) return result;
  // Older claims have no reliable continuation count. Never present a partial history as a lifetime cap.
  const claims = await client.list(`${prefix}/git/matching-refs/tags/crewbie/claims/`);
  for (const raw of claims) {
    const match = /^refs\/tags\/crewbie\/claims\/(\d+)$/.exec(string(raw.ref, "claim ref"));
    if (!match) throw new Error("Invalid claim ledger.");
    const number = integer(Number(match[1]), "claimed issue");
    if (entries.some((entry) => entry.issue === number)) continue;
    const claimed = record(await client.request("GET", `${prefix}/issues/${number}`), "claimed issue");
    const prior = taskMetadata(string(claimed.body, "claimed body"));
    if (!prior) throw new Error("Claimed issue has no Crewbie metadata.");
    if (prior.batch === batch) {
      result.blocked = `Batch ${batch} has pre-ledger claim #${number}; historical attempts are unverified. Review its history, then use budget --issue ${number} --historical-attempts COUNT to preview an explicit baseline; no automatic allowance reset.`;
      break;
    }
  }
  return result;
}
export async function baselineLaunches(client: GitHubApi, config: Config, issue: number, attempts: number, apply: boolean): Promise<string> {
  integer(issue, "issue"); integer(attempts, "historical attempts", 1, 10000);
  const prefix = `/repos/${config.repository}`;
  const inspect = async () => {
    await client.request("GET", `${prefix}/git/ref/tags/crewbie/claims/${issue}`);
    const original = record(await client.request("GET", `${prefix}/issues/${issue}`), "claimed issue");
    const metadata = taskMetadata(string(original.body, "issue body"));
    if (!metadata) throw new Error("Claimed issue has no Crewbie metadata.");
    const path = `tags/crewbie/launches/${metadata.batch}/${metadata.task.id}/${issue}/`;
    if ((await client.list(`${prefix}/git/matching-refs/${path}`)).length) throw new Error("Launch history already exists for this issue; baselines cannot overwrite or refund attempts.");
    return { metadata, path };
  };
  const prior = await inspect();
  if (!apply) return `Preview: record ${attempts} historical attempts for #${issue} in batch ${prior.metadata.batch}. This is YOUR attestation after reviewing prior initial, continuation and uncertain launches, not measured telemetry. It consumes allowance and cannot be reset. Repeat with --apply; no agents will start.`;
  await requireApprover(client, config.approvers);
  return withDispatchLock(client, config, async () => {
    const fresh = await inspect();
    if (fresh.path !== prior.path) throw new Error("Historical task identity changed; preview again.");
    const baseline = { schemaVersion: 1, batch: fresh.metadata.batch, task: fresh.metadata.task.id, issue, attempts };
    const tag = record(await client.request("POST", `${prefix}/git/tags`, {
      tag: `${fresh.path}baseline`, message: JSON.stringify(baseline), object: await defaultHead(client, config), type: "commit",
    }), "baseline tag");
    await client.request("POST", `${prefix}/git/refs`, { ref: `refs/${fresh.path}baseline`, sha: string(tag.sha, "baseline SHA") });
    return `Recorded the human-attested baseline of ${attempts} attempts for #${issue}. No history reset, paid launch or model change occurred. Run preflight again.`;
  });
}
export async function reserveLaunch(client: GitHubApi, config: Config, metadata: Metadata, issue: number, baseSha: string, initial = false): Promise<LaunchAllowance> {
  const allowance = await launchAllowance(client, config, metadata, issue);
  if (allowance.blocked) throw new Error(allowance.blocked);
  if (initial && allowance.issueUsed > 0) throw new Error("Initial launch already reserved; inspect its outcome instead of retrying.");
  // Refunded start failures lower the count, so number after the highest existing ref rather than reuse one.
  const existing = await client.list(`/repos/${config.repository}/git/matching-refs/tags/crewbie/launches/${allowance.batch}/${allowance.task}/`);
  const highest = Math.max(0, ...existing.map((raw) => Number(/\/(\d+)$/.exec(string(raw.ref, "launch ref"))?.[1] ?? 0)));
  await client.request("POST", `/repos/${config.repository}/git/refs`, {
    ref: `refs/tags/crewbie/launches/${allowance.batch}/${allowance.task}/${issue}/${Math.max(allowance.taskUsed, highest) + 1}`, sha: baseSha,
  });
  return allowance;
}
export async function checkLaunchModels(models: ModelChoice[], tasks: { owner: string; model: string }[], config: Config): Promise<void> {
  if (!models.length) throw new Error("Launch preflight returned no enabled account models; nothing was launched.");
  for (const task of tasks) {
    if (!config.roles.some((role) => role.id === task.owner && role.model === task.model)) throw new Error("Launch specialist/model differs from approved policy.");
    if (!models.some((model) => model.id === task.model)) throw new Error(`Launch model ${task.model} is absent from the live account catalog. Review model selection; no fallback or paid retry was attempted.`);
  }
}
