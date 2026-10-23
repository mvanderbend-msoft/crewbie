import { SHARED_HOT } from "../memory/context.js";
import { launchMemory } from "../memory/launch.js";
import { reviewerFor, type Config } from "../config.js";
import { integer, record, string } from "../core.js";
import { isWriter, type GitHubApi } from "../tracking/github.js";
import { setStatus } from "../tracking/issues.js";
import { cloudTasks, pullTaskIds } from "../tracking/native.js";
import { checkLaunchModels, launchAllowance, modelRejection, probeCloudAgent, reserveLaunch, type DiscoverModels } from "./controls.js";
import { parseFindings, type Finding, type TrustedReview } from "./pr-review.js";
import type { Work } from "./dispatch.js";

const MARKER = /^<!-- crewbie-task-fix:([A-Za-z0-9+/=]+) -->/;
const TERMINAL = new Set(["completed", "failed", "timed_out", "cancelled"]);

/** Heads for which Crewbie already asked the owner to fix a changes-requested review; unedited comments by a writer only. */
export async function fixedHeads(client: GitHubApi, config: Config, comments: Record<string, unknown>[]): Promise<string[]> {
  const heads: string[] = [];
  for (const comment of comments) {
    const match = MARKER.exec(String(comment.body ?? ""));
    if (!match?.[1] || comment.created_at !== comment.updated_at || !await isWriter(client, config.repository, comment.user)) continue;
    try {
      const data = record(JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as unknown, "task fix marker");
      if (typeof data.head === "string") heads.push(data.head);
    } catch { continue; }
  }
  return heads;
}

export function taskFixPrompt(item: Work, review: TrustedReview, findings: Finding[], reviewer: string): string {
  const pr = integer(item.pull!.number, "task PR"), issue = integer(item.issue.number, "task issue");
  const { owner, body } = item.metadata.task;
  const list = findings.length
    ? findings.map((finding) => `- ${finding.severity}: ${finding.path}${finding.line === null ? "" : `:${finding.line}`} — ${finding.body}`).join("\n")
    : "- See the review comment; its findings could not be read back.";
  return [
    `Continue your existing PR #${pr} for issue #${issue} as crewbie-${owner}. The Crewbie review by crewbie-${reviewer} requested changes on head ${review.head.slice(0, 7)} (${review.url || `PR #${pr}`}):`,
    list,
    `Fix every blocking finding within the approved scope of issue #${issue}; fix minor ones when cheap and in scope, otherwise explain them in the PR handoff. If a finding is wrong, explain why in the handoff instead of changing code. Do not widen scope. Run focused checks for what you changed. Keep "Closes #${issue}" and "Specialist: crewbie-${owner}" in the PR description.`,
    `Then learn from the review: for each finding that exposes a reusable, non-obvious lesson for future crewbie-${owner} tasks (a gotcha, convention or check you missed), add or update one short entry in .crewbie/team/${owner}/hot.md following the memory rules, ending with <!-- source: PR #${pr} review -->. Put lessons every role must follow in ${SHARED_HOT}. Skip one-off fixes and never write implementation summaries.`,
    `Approved task:\n${body}`,
  ].join("\n\n");
}

interface FixContext { active: number; verify: () => Promise<unknown>; discoverModels: DiscoverModels }

/**
 * After a task PR's Crewbie review requests changes, asks the same specialist to fix it on the PR's branch.
 * One request per reviewed head, bounded by the task's attempt allowance; the session's completion then re-runs review and merge.
 * The marker comment is written before launching, so an uncertain launch is never retried automatically.
 */
export async function requestTaskFix(client: GitHubApi, config: Config, item: Work, review: TrustedReview, context: FixContext): Promise<string> {
  const pull = item.pull!;
  const number = integer(pull.number, "task PR"), issue = integer(item.issue.number, "task issue");
  const { owner, model } = item.metadata.task;
  const reviewer = reviewerFor(config)?.role ?? "reviewer";
  const head = review.head.slice(0, 7);
  const lead = `crewbie-${reviewer} requested changes on ${head}`;
  const prComments = await client.list(`/repos/${config.repository}/issues/${number}/comments`);
  if ((await fixedHeads(client, config, prComments)).includes(review.head)) {
    return `${lead}. Crewbie already asked crewbie-${owner} to fix this head and asks once per head; the fix session left no new commits or did not start. Push fixes yourself or merge manually.`;
  }
  if (context.active >= config.maxActive) return `${lead}. Crewbie asks crewbie-${owner} to fix it when a session slot frees (${context.active}/${config.maxActive}).`;
  const allowance = await launchAllowance(client, config, item.metadata, issue);
  if (allowance.blocked) return `${lead}. Crewbie cannot ask for a fix: ${allowance.blocked} Push fixes yourself or merge manually.`;
  try {
    await checkLaunchModels(await context.discoverModels(), [item.metadata.task], config);
    // Fix sessions use the tasks API, unlike issue assignment; probe before the marker and reservation so a missing permission costs nothing and is retried.
    const probe = await probeCloudAgent(client, config.repository, model);
    if (probe.forbidden) return `${lead}. Crewbie cannot ask crewbie-${owner} for a fix: CREWBIE_USER_TOKEN cannot create agent tasks (HTTP 403). Grant it Repository permissions → Agent tasks: read and write; the next dispatch then asks for the fix. Or push fixes yourself.`;
    if (!probe.accepted) return `${lead}. Crewbie cannot ask for a fix: ${modelRejection(model, owner)}`;
  } catch (error) { return `${lead}. Crewbie cannot ask for a fix: ${error instanceof Error ? error.message : "model check failed"}`; }
  await context.verify();
  const snapshot = await cloudTasks(client, config.repository);
  if (snapshot.warning) return `${lead}. Crewbie cannot ask for a fix: ${snapshot.warning}`;
  const previous = pullTaskIds(snapshot.tasks, pull);
  if (snapshot.tasks.some((task) => previous.includes(String(task.id)) && !TERMINAL.has(String(task.state)))) return `${lead}. A session on this PR is still running; Crewbie asks for a fix once it ends.`;
  const headRef = string(record(pull.head, "PR head").ref, "PR head ref"), baseRef = string(record(pull.base, "PR base").ref, "PR base ref");
  const memory = await launchMemory(client, config, owner, headRef);
  const reserved = await reserveLaunch(client, config, item.metadata, issue, review.head, false, memory.context);
  const attempt = `attempt ${reserved.taskUsed + 1} of ${reserved.maxAttemptsPerTask}`;
  const marker = Buffer.from(JSON.stringify({ head: review.head, pr: number })).toString("base64");
  await client.request("POST", `/repos/${config.repository}/issues/${number}/comments`, {
    body: `<!-- crewbie-task-fix:${marker} -->\nCrewbie asked crewbie-${owner} to fix the review findings on ${head} in this PR (${attempt} for this task) and to record lasting lessons in its memory. Crewbie reviews the new head and merges it once the review passes.`,
  });
  let id: string;
  try {
    const result = record(await client.request("POST", `/agents/repos/${config.repository}/tasks`, {
      custom_agent: `crewbie-${owner}`, model, create_pull_request: false, base_ref: baseRef, head_ref: headRef,
      prompt: `${taskFixPrompt(item, review, parseFindings(review.body), reviewer)}\n${memory.text}`,
    }), "fix session response");
    id = string(result.id, "fix session ID");
  } catch (error) {
    throw new Error(`The fix request for PR #${number} has an unknown outcome; inspect the PR's sessions before pushing fixes yourself. Crewbie does not retry it. ${error instanceof Error ? error.message : ""}`.trim());
  }
  // The receipt tells dispatch which of the PR's sessions is current, so the earlier completed one no longer counts.
  await client.request("POST", `/repos/${config.repository}/issues/${issue}/comments`, {
    body: `<!-- crewbie-continuation:${Buffer.from(JSON.stringify({ task: id, previous: previous.filter((task) => task !== id) })).toString("base64")} -->`,
  });
  item.state = "running"; item.sessionComplete = false;
  await setStatus(client, config.repository, item.issue, "running");
  return `${lead}. Crewbie asked crewbie-${owner} to fix it on this PR (${attempt}); it reviews the new head and merges once the review passes.`;
}
