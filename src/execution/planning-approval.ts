import { parseConfig, requireExecution, type Config } from "../config.js";
import { GitHubError, hash, integer, json, record, string, textHash } from "../core.js";
import { approvedBatch, batchDigest, parseBatch, type Batch } from "../specification/batch.js";
import { isWriter, type GitHubApi } from "../tracking/github.js";
import { verifySources } from "../tracking/sources.js";
import { publish } from "../tracking/issues.js";
import { withDispatchLock } from "./dispatch.js";
import type { AdoApi } from "../tracking/ado.js";

export interface PlanExecution {
  schemaVersion: 1;
  sourceIssue: number;
  runId: number;
  baseSha: string;
  key: string;
  baseConfigHash: string;
  configHash: string;
  batchDigest: string;
  files: Record<string, string>;
}
function sha(value: unknown): string {
  const result = string(value, "commit SHA");
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error("Expected an exact commit SHA.");
  return result;
}
function digest(value: unknown): string {
  const result = string(value, "content fingerprint");
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Expected a SHA-256 fingerprint.");
  return result;
}
export async function repoText(client: GitHubApi, repo: string, path: string, ref: string): Promise<{ content: string; sha: string }> {
  const file = record(await client.request("GET", `/repos/${repo}/contents/${path}?ref=${sha(ref)}`), "repository file");
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.size !== "number" || file.size > 100_000) throw new Error(`Expected a bounded regular file: ${path}`);
  const content = Buffer.from(string(file.content, "file content", true), "base64").toString("utf8");
  if (Buffer.byteLength(content) > 100_000) throw new Error(`Repository file exceeds 100 KB: ${path}`);
  return { content, sha: sha(file.sha) };
}
export async function verifyPlanningRun(client: GitHubApi, config: Config, runId: number, baseSha: string, completed = false): Promise<string> {
  const run = record(await client.request("GET", `/repos/${config.repository}/actions/runs/${integer(runId, "planning run")}`), "planning workflow run");
  if (!["issues", "issue_comment", "workflow_dispatch"].includes(String(run.event)) || run.path !== ".github/workflows/crewbie-plan.yml" || run.head_sha !== baseSha
    || record(run.head_repository, "run repository").full_name !== config.repository || !await isWriter(client, config.repository, run.actor)
    || (run.triggering_actor !== undefined && !await isWriter(client, config.repository, run.triggering_actor))
    || (completed && (run.status !== "completed" || run.conclusion !== "success"))) {
    throw new Error("Planning must originate from the approved default-branch issue workflow and complete successfully before execution.");
  }
  return string(run.head_branch, "planning branch");
}
function executionManifest(value: unknown): PlanExecution {
  const data = record(value, "execution manifest");
  if (data.schemaVersion !== 1) throw new Error("Unsupported execution manifest.");
  const files = Object.fromEntries(Object.entries(record(data.files, "reviewed files")).map(([path, value]) => [path, digest(value)]));
  if (!Object.keys(files).length || Object.keys(files).length > 100) throw new Error("Execution manifest requires 1-100 reviewed files.");
  return {
    schemaVersion: 1, sourceIssue: integer(data.sourceIssue, "source issue"), runId: integer(data.runId, "planning run"),
    baseSha: sha(data.baseSha), key: digest(data.key), baseConfigHash: digest(data.baseConfigHash),
    configHash: digest(data.configHash), batchDigest: digest(data.batchDigest), files,
  };
}
export function allowedPlanningFile(path: string, directory: string): boolean {
  return [`${directory}/setup.json`, `${directory}/batch.json`, `${directory}/plan.md`].includes(path);
}
export function planningLocation(ref: string): { sourceIssue: number; keyPrefix: string; directory: string } {
  const match = /^crewbie\/plans\/((?:[a-z0-9]+(?:-[a-z0-9]+)*-)?issue-(\d+))-([a-f0-9]{16})$/.exec(ref);
  if (!match) throw new Error("Expected a generated planning branch.");
  return { sourceIssue: integer(Number(match[2]), "source issue"), keyPrefix: match[3]!, directory: `.crewbie/plans/${match[1]}` };
}
function nonRolePolicy(config: Config): unknown {
  const { roles: _roles, ...policy } = config as Config & { approvers?: unknown };
  delete policy.approvers;
  return policy;
}

export async function approvedMergedPlan(client: GitHubApi, config: Config, number: number): Promise<{ batch: Batch; headSha: string; approver: string; merger: string }> {
  if (!config.planning?.enabled || !config.planning.executeOnMerge) throw new Error("Execution on planning-PR merge is not enabled.");
  requireExecution(config);
  const prefix = `/repos/${config.repository}`;
  const pr = record(await client.request("GET", `${prefix}/pulls/${integer(number, "planning PR")}`), "planning PR");
  const head = record(pr.head, "planning head"), base = record(pr.base, "planning base");
  const location = planningLocation(string(head.ref, "planning branch"));
  if (pr.merged !== true || pr.state !== "closed" || pr.draft !== false
    || record(head.repo, "head repository").full_name !== config.repository
    || record(base.repo, "base repository").full_name !== config.repository) throw new Error("Only a merged, same-repository planning PR can authorize execution.");
  const headSha = sha(head.sha), mergeSha = sha(pr.merge_commit_sha);
  const directory = location.directory;
  const manifestPath = `${directory}/execution.json`;
  let manifestFile: { content: string; sha: string };
  try { manifestFile = await repoText(client, config.repository, manifestPath, headSha); }
  catch (error) {
    if (error instanceof GitHubError && error.status === 404) throw new Error("This PR has no executable planning manifest. Resolve questions and generate a merge-enabled plan before requesting execution.");
    throw error;
  }
  const manifest = executionManifest(JSON.parse(manifestFile.content) as unknown);
  if (manifest.sourceIssue !== location.sourceIssue || !manifest.key.startsWith(location.keyPrefix)
    || !String(pr.body ?? "").includes(`<!-- crewbie-plan:${manifest.key} -->`)) throw new Error("Planning PR provenance does not match its execution manifest.");
  const original = parseConfig(JSON.parse((await repoText(client, config.repository, ".crewbie/config.json", manifest.baseSha)).content) as unknown);
  if (original.repository !== config.repository || !original.planning?.enabled || !original.planning.executeOnMerge
    || hash(json(original)) !== manifest.baseConfigHash
    || json(nonRolePolicy(original)) !== json(nonRolePolicy(config))) {
    throw new Error("A planning PR cannot grant itself execution permission or replace prior policy.");
  }

  const runBranch = await verifyPlanningRun(client, original, manifest.runId, manifest.baseSha, true);
  const repository = record(await client.request("GET", prefix), "repository");
  if (base.ref !== repository.default_branch) throw new Error("Planning must be merged into the current default branch.");
  if (runBranch !== repository.default_branch) throw new Error("Planning policy must come from a default-branch workflow run.");
  if (!await isWriter(client, original.repository, pr.merged_by)) throw new Error("A human user with write access must merge the planning PR.");
  const mergedAt = Date.parse(string(pr.merged_at, "merge time"));
  if (!Number.isFinite(mergedAt)) throw new Error("Invalid merge time.");
  const reviews = await client.list(`${prefix}/pulls/${number}/reviews`);
  const latest = new Map<string, Record<string, unknown>>();
  for (const review of [...reviews].sort((a, b) => integer(a.id, "review ID") - integer(b.id, "review ID"))) {
    if (!await isWriter(client, original.repository, review.user) || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(String(review.state))) continue;
    const submitted = Date.parse(string(review.submitted_at, "review time"));
    if (!Number.isFinite(submitted)) throw new Error("Invalid review time.");
    if (submitted <= mergedAt) latest.set(string(record(review.user, "reviewer").login, "reviewer login"), review);
  }
  if ([...latest.values()].some((review) => review.state === "CHANGES_REQUESTED")) throw new Error("A write-access human reviewer still requests changes.");
  const approval = [...latest.values()].find((review) => review.state === "APPROVED" && review.commit_id === headSha);
  if (!approval) throw new Error("A configured human must approve the exact final planning head before merge.");
  const current = record(await client.request("GET", `${prefix}/git/ref/heads/${encodeURIComponent(string(repository.default_branch, "default branch"))}`), "default ref");
  const currentSha = sha(record(current.object, "default ref object").sha);
  const compare = record(await client.request("GET", `${prefix}/compare/${mergeSha}...${currentSha}`), "merge ancestry");
  if (!["ahead", "identical"].includes(String(compare.status)) || record(compare.merge_base_commit, "merge base").sha !== mergeSha) throw new Error("The approved planning merge is no longer on the default branch.");
  const files = await client.list(`${prefix}/pulls/${number}/files`);
  const expected = new Set([...Object.keys(manifest.files), manifestPath]);
  const changed = new Map(files.map((file) => [string(file.filename, "changed file"), file]));
  if (files.length > expected.size || pr.changed_files !== files.length || changed.size !== files.length
    || !changed.has(manifestPath)) throw new Error("Planning PR file coverage is incomplete or differs from the approved manifest.");
  for (const [path, file] of changed) {
    if (!expected.has(path)
      || !["added", "modified"].includes(String(file.status)) || file.previous_filename !== undefined) throw new Error(`Planning PR contains an unapproved change: ${path}`);
  }
  const contents = new Map<string, string>();
  for (const path of expected) {
    if (path !== manifestPath && !allowedPlanningFile(path, directory)) throw new Error(`Planning manifest contains a non-plan file: ${path}. Planning PRs may only add plan files; regenerate the plan.`);
    const approved = path === manifestPath ? manifestFile : await repoText(client, config.repository, path, headSha);
    const file = changed.get(path);
    if (file) {
      if (approved.sha !== file.sha) throw new Error(`Planning file is not the reviewed regular blob: ${path}`);
    } else {
      // GitHub omits unchanged files from the PR diff, not from the reviewed manifest.
      let prior: { content: string; sha: string };
      try { prior = await repoText(client, config.repository, path, manifest.baseSha); }
      catch (error) {
        if (error instanceof GitHubError && error.status === 404) throw new Error(`Planning PR file coverage omits a missing file: ${path}`);
        throw error;
      }
      if (prior.sha !== approved.sha) throw new Error(`Planning PR file coverage omits a changed file: ${path}`);
    }
    const fingerprint = textHash(approved.content);
    if (path !== manifestPath && fingerprint !== manifest.files[path]) throw new Error(`Planning file changed after generation: ${path}. Regenerate the plan and review the new head.`);
    for (const revision of new Set([mergeSha, currentSha])) {
      if (textHash((await repoText(client, config.repository, path, revision)).content) !== fingerprint) throw new Error(`Reviewed planning content changed at merge or afterwards: ${path}`);
    }
    contents.set(path, approved.content);
  }
  if (manifest.configHash !== hash(json(config))) throw new Error("Active team configuration differs from the reviewed plan.");
  const mergedConfig = parseConfig(JSON.parse((await repoText(client, config.repository, ".crewbie/config.json", currentSha)).content) as unknown);
  if (json(mergedConfig) !== json(config)) throw new Error("Checked-out configuration is stale.");
  const batchText = contents.get(`${directory}/batch.json`);
  if (!batchText) throw new Error("Resolve planning questions before requesting execution.");
  const batch = parseBatch(JSON.parse(batchText) as unknown, config);
  if (batch.approval !== null || batchDigest(batch) !== manifest.batchDigest) throw new Error("The coordinator cannot self-approve or change the reviewed task batch.");
  const source = `https://github.com/${config.repository}/issues/${manifest.sourceIssue}`;
  if (batch.sources.length !== 1 || batch.sources[0]?.uri !== source || !batch.sources[0].fingerprint) throw new Error("Execution must retain the exact planning source.");
  await verifySources(batch.sources, client, config);
  const fresh = record(await client.request("GET", `${prefix}/git/ref/heads/${encodeURIComponent(string(repository.default_branch, "default branch"))}`), "current default ref");
  if (record(fresh.object, "ref object").sha !== currentSha) throw new Error("Default branch changed during authorization. Retry against stable reviewed content.");
  return { batch: approvedBatch(batch, true), headSha, approver: string(record(approval.user, "approver").login, "approver login"), merger: string(record(pr.merged_by, "merger").login, "merger login") };
}

export async function releaseMergedPlan(client: GitHubApi, config: Config, number: number, ado?: AdoApi): Promise<string> {
  const proof = await approvedMergedPlan(client, config, number);
  const mappings = await withDispatchLock(client, config, async () => {
    const published = await publish(client, config, proof.batch, ado, false);
    for (const item of published) {
      const path = `/repos/${config.repository}/issues/${item.issue}/comments`;
      const body = `Execution authorized by ${proof.approver}'s approval and ${proof.merger}'s merge of planning PR #${number}, reviewed head \`${proof.headSha}\`.\nRecorded by the configured automation credential; no agent self-approval.\n\n<!-- crewbie-plan-approval:${number}:${proof.headSha} -->`;
      const comments = await client.list(path);
      let exists = false;
      for (const comment of comments) {
        if (comment.created_at === comment.updated_at && comment.body === body && await isWriter(client, config.repository, comment.user)) exists = true;
      }
      if (!exists) {
        await client.request("POST", path, { body });
      }
    }
    return published;
  });
  const repository = record(await client.request("GET", `/repos/${config.repository}`), "repository");
  await client.request("POST", `/repos/${config.repository}/actions/workflows/crewbie-dispatch.yml/dispatches`, {
    ref: string(repository.default_branch, "default branch"), inputs: { issue_numbers: mappings.map((item) => item.issue).join(",") },
  });
  return `Published ${mappings.length} specialist-owned tasks from approved planning PR #${number}; guarded cloud dispatch requested. Existing matching issues and persistent launch claims are reused on recovery.`;
}
