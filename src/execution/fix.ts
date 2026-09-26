import type { Config } from "../config.js";
import { GitHubError, integer, record, string } from "../core.js";
import { approvedBatch, issueBody, issueDigest, taskMetadata, type Batch, type Task, type TaskMetadata } from "../specification/batch.js";
import { isWriter, type GitHubApi } from "../tracking/github.js";
import { approvalComment, ensureLabels, hasApproval, managedIssues } from "../tracking/issues.js";
import { verifySources } from "../tracking/sources.js";
import { updateFeatureBody, linkedPull, type FeatureBodyItem } from "./dispatch.js";
import { featureTasks, trustedLatestReview, type Finding } from "./pr-review.js";

const COMMAND = /^\s*\/crewbie\s+(fix|revise)\b[:\s]*/i;
const ACK_MARKER = /^<!-- crewbie-fix:([A-Za-z0-9+/=]+) -->/;
const sourceMarker = (comment: number) => `<!-- crewbie-fix-source:${comment} -->`;

interface MergedTask {
  issue: Record<string, unknown>;
  metadata: TaskMetadata;
  pull: Record<string, unknown>;
  files: string[];
}
interface CreatedIssue { task: string; owner: string; issue: number; url: string }

function marker(body: string): { comment: number; issues: number[] } | null {
  const match = ACK_MARKER.exec(body);
  if (!match?.[1]) return null;
  try {
    const data = record(JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as unknown, "fix receipt");
    const issues = Array.isArray(data.issues) ? data.issues.map((value) => integer(value, "fix issue")) : [];
    return { comment: integer(data.comment, "comment"), issues };
  } catch { return null; }
}
async function trustedReceipt(client: GitHubApi, comments: Record<string, unknown>[], comment: number): Promise<{ comment: number; issues: number[] } | null> {
  const marked = comments.map((item) => ({ comment: item, receipt: marker(String(item.body ?? "")) })).filter((item) => item.receipt?.comment === comment);
  if (!marked.length) return null;
  const user = record(await client.request("GET", "/user"), "authenticated user");
  const login = String(user.login ?? "");
  for (const item of marked) {
    if (item.comment.created_at !== item.comment.updated_at) continue;
    const author = item.comment.user === null || item.comment.user === undefined ? null : record(item.comment.user, "receipt author");
    if (author && String(author.login ?? "").toLowerCase() === login.toLowerCase()) return item.receipt!;
  }
  return null;
}
function parseFindings(reviewBody: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of reviewBody.matchAll(/^- \*\*(Blocking|Minor)\*\* `([^`]+)`: (.+)$/gmi)) {
    const location = match[2]!;
    const line = /^(.*):(\d+)$/.exec(location);
    findings.push({
      severity: match[1] === "Blocking" ? "blocking" : "minor",
      path: line ? line[1]! : location,
      line: line ? integer(Number(line[2]), "finding line", 0) : null,
      body: match[3]!.trim(),
    });
  }
  return findings;
}
function directory(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
function overlaps(path: string, dir: string): boolean {
  if (!dir) return !path.includes("/");
  return path === dir || path.startsWith(`${dir}/`);
}
async function syncDefault(client: GitHubApi, config: Config, featureBranch: string, defaultBranch: string): Promise<"merged" | "current" | "conflict"> {
  try {
    const result = await client.request("POST", `/repos/${config.repository}/merges`, {
      base: featureBranch, head: defaultBranch,
      commit_message: `Crewbie: merge ${defaultBranch} into ${featureBranch} before fixes`,
    });
    return result === null ? "current" : "merged";
  } catch (error) {
    if (error instanceof GitHubError && error.status === 409) return "conflict";
    throw error;
  }
}
async function mergedTasks(client: GitHubApi, config: Config, tasks: { issue: Record<string, unknown>; metadata: TaskMetadata }[]): Promise<MergedTask[]> {
  const result: MergedTask[] = [];
  for (const task of tasks) {
    const pull = await linkedPull(client, config.repository, integer(task.issue.number, "task issue"), task.metadata.branch);
    if (!pull?.merged_at) continue;
    const files = (await client.list(`/repos/${config.repository}/pulls/${integer(pull.number, "task PR")}/files`)).map((file) => string(file.filename, "changed file"));
    result.push({ ...task, pull, files });
  }
  return result;
}
function ownerForFinding(finding: Finding, tasks: { issue: Record<string, unknown>; metadata: TaskMetadata }[], merged: MergedTask[]): string {
  const direct = merged.find((task) => task.files.includes(finding.path));
  if (direct) return direct.metadata.task.owner;
  const dir = directory(finding.path);
  const scores = new Map<string, number>();
  for (const task of merged) {
    const count = task.files.filter((path) => overlaps(path, dir)).length;
    if (count) scores.set(task.metadata.task.owner, (scores.get(task.metadata.task.owner) ?? 0) + count);
  }
  const best = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (best) return best[0];
  return (tasks.find((task) => task.metadata.task.kind !== "review") ?? tasks[0]!).metadata.task.owner;
}
function ownerWithMostChanges(tasks: { issue: Record<string, unknown>; metadata: TaskMetadata }[], merged: MergedTask[]): string {
  const scores = new Map<string, number>();
  for (const task of merged) scores.set(task.metadata.task.owner, (scores.get(task.metadata.task.owner) ?? 0) + task.files.length);
  return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    ?? (tasks.find((task) => task.metadata.task.kind !== "review") ?? tasks[0]!).metadata.task.owner;
}
function taskBody(owner: string, findings: Finding[], notes: string, stale: string, comment: number): string {
  const findingLines = findings.length ? findings.map((finding) =>
    `- ${finding.severity}: ${finding.path}${finding.line === null ? "" : `:${finding.line}`} — ${finding.body}`).join("\n") : "- No structured review findings were available for this owner.";
  const note = notes ? `\n\n## Write-access user notes\n\n${notes}` : "";
  return `Address the Crewbie feature-PR review feedback assigned to crewbie-${owner}.${stale}

## Findings to address or explain

${findingLines}${note}

## Acceptance criteria
- Each finding above is addressed in code or explicitly explained in the PR handoff if no code change is needed.
- Existing behavior remains covered by relevant checks.
- The feature branch remains ready for a new Crewbie review.

${sourceMarker(comment)}`;
}
function conflictBody(defaultBranch: string, featureBranch: string, notes: string, comment: number): string {
  return `Make \`${featureBranch}\` mergeable with \`${defaultBranch}\` before review fixes continue.

In your task branch, which starts from \`${featureBranch}\`, merge \`origin/${defaultBranch}\`, resolve conflicts preserving both sides' intent, and open the task PR back into \`${featureBranch}\`. If the merge brings changes under \`.github/workflows/\`, Crewbie's existing auto-merge guard may leave that task PR for a human to merge.
${notes ? `\nHuman notes from the fix request:\n\n${notes}\n` : ""}
## Acceptance criteria
- The task PR merges the current \`${defaultBranch}\` into the feature branch's work branch.
- Conflicts are resolved without discarding either side's intended behavior.
- Existing behavior remains covered by relevant checks.

${sourceMarker(comment)}`;
}
async function publishFixTasks(client: GitHubApi, config: Config, batch: Batch, digest: string, branch: string, tasks: Task[]): Promise<CreatedIssue[]> {
  await ensureLabels(client, config);
  const existing = await managedIssues(client, config.repository);
  const created: CreatedIssue[] = [];
  for (const task of tasks) {
    const body = issueBody(batch, task, { batchDigest: digest, branch });
    let issue = existing.find((candidate) => {
      const metadata = taskMetadata(String(candidate.body ?? ""));
      return metadata?.batch === batch.id && metadata.batchDigest === digest && metadata.task.id === task.id;
    });
    if (issue && (issue.title !== task.title || issue.body !== body)) throw new Error(`Existing ${task.id} issue differs from this fix request; reconcile before retrying.`);
    if (!issue) {
      issue = record(await client.request("POST", `/repos/${config.repository}/issues`, {
        title: task.title, body, labels: ["crewbie:managed", `crewbie:owner:${task.owner}`, "crewbie:blocked"],
      }), "created issue");
      existing.push(issue);
    }
    const number = integer(issue.number, "issue number");
    if (!await hasApproval(client, config, issue, true)) {
      await client.request("POST", `/repos/${config.repository}/issues/${number}/comments`, { body: approvalComment(issueDigest(task.title, body), true) });
    }
    created.push({ task: task.id, owner: task.owner, issue: number, url: String(issue.html_url ?? `https://github.com/${config.repository}/issues/${number}`) });
  }
  return created;
}
export async function handleFeatureFixComment(client: GitHubApi, config: Config, event: unknown): Promise<string> {
  const data = record(event, "issue comment event");
  if (data.action !== "created") return "Only new comments can request Crewbie fixes.";
  if (record(data.repository, "event repository").full_name !== config.repository) throw new Error("Fix event targets another repository.");
  const issue = record(data.issue, "comment issue");
  if (!issue.pull_request) return "Comment is not on a pull request.";
  const comment = record(data.comment, "comment");
  const body = String(comment.body ?? "");
  const command = COMMAND.exec(body);
  if (!command) return "No /crewbie fix command found.";
  if (comment.created_at !== comment.updated_at) return "Edited comments do not request Crewbie fixes.";
  if (!await isWriter(client, config.repository, comment.user) || !await isWriter(client, config.repository, data.sender)) return "Only unedited comments from write-access users request Crewbie fixes.";
  const number = integer(issue.number, "feature PR");
  const commentId = integer(comment.id, "comment");
  const comments = await client.list(`/repos/${config.repository}/issues/${number}/comments`);
  const priorReceipt = await trustedReceipt(client, comments, commentId);
  const pull = record(await client.request("GET", `/repos/${config.repository}/pulls/${number}`), "feature PR");
  const head = record(pull.head, "PR head");
  if (String(head.ref ?? "").startsWith("crewbie/plans/")) {
    return command[1]!.toLowerCase() === "revise" ? "Planning PR /crewbie revise is handled by the planning workflow." : "This PR is not a Crewbie feature PR.";
  }
  const feature = await featureTasks(client, config, pull);
  if (!feature) return command[1]!.toLowerCase() === "revise" ? "This PR is not a Crewbie feature PR, so /crewbie revise remains a planning-PR command." : "This PR is not a Crewbie feature PR.";
  const tasks = feature.tasks;
  const digest = tasks[0]!.metadata.batchDigest;
  try {
    await verifySources(tasks[0]!.metadata.sources, client, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source verification failed.";
    await client.request("POST", `/repos/${config.repository}/issues/${number}/comments`, { body: `Crewbie could not create fix tasks: the PRD changed since planning; replan or revert the edit.\n\n${message}` });
    return "The PRD changed since planning; replan or revert the edit before requesting fixes.";
  }
  const managed = await managedIssues(client, config.repository);
  const already = managed.filter((candidate) => {
    const metadata = taskMetadata(String(candidate.body ?? ""));
    return metadata?.batch === feature.batch && metadata.batchDigest === digest && String(candidate.body ?? "").includes(sourceMarker(commentId));
  });
  const repository = record(await client.request("GET", `/repos/${config.repository}`), "repository");
  const defaultBranch = string(repository.default_branch, "default branch");
  const sync = await syncDefault(client, config, feature.branch, defaultBranch);
  const review = await trustedLatestReview(client, config, number, comments);
  const findings = review?.verdict === "changes" ? parseFindings(review.body) : [];
  const notes = body.replace(COMMAND, "").trim();
  if (Buffer.byteLength(notes) > 8000) throw new Error("Fix notes exceed 8000 bytes. Split the request.");
  if (!findings.length && !notes && sync !== "conflict") {
    await postReceipt(client, config, number, commentId, [], "Crewbie found nothing to fix: the latest trusted review has no changes-requested findings, the feature branch is up to date or merged cleanly with the default branch, and the comment had no notes.");
    return "Nothing to fix.";
  }
  const merged = await mergedTasks(client, config, tasks);
  const nonReview = tasks.find((task) => task.metadata.task.kind !== "review") ?? tasks[0]!;
  const existingIds = managed.map((candidate) => taskMetadata(String(candidate.body ?? ""))?.task.id).filter(Boolean) as string[];
  const existingRound = already.map((candidate) => /^fix-(\d+)-/.exec(taskMetadata(String(candidate.body ?? ""))?.task.id ?? "")?.[1]).find(Boolean);
  const round = existingRound ? integer(Number(existingRound), "fix round") : Math.max(0, ...existingIds.map((id) => /^fix-(\d+)-/.exec(id)?.[1]).filter(Boolean).map(Number)) + 1;
  const newTasks: Task[] = [];
  let conflictId: string | null = null;
  if (sync === "conflict") {
    const owner = ownerWithMostChanges(tasks, merged) || nonReview.metadata.task.owner;
    const role = config.roles.find((role) => role.id === owner);
    if (!role) throw new Error(`No configured role for conflict owner ${owner}.`);
    conflictId = `fix-${round}-conflict`;
    newTasks.push({ id: conflictId, title: `Resolve ${feature.branch} conflicts with ${defaultBranch}`, body: conflictBody(defaultBranch, feature.branch, notes, commentId), owner, model: role.model, priority: 0, dependsOn: [] });
  }
  const byOwner = new Map<string, Finding[]>();
  if (findings.length) for (const finding of findings) {
    const owner = ownerForFinding(finding, tasks, merged);
    byOwner.set(owner, [...byOwner.get(owner) ?? [], finding]);
  } else if (notes) byOwner.set(ownerWithMostChanges(tasks, merged), []);
  const stale = review && string(record(pull.head, "PR head").sha, "PR head SHA") !== review.head ? ` The latest changes-requested review was for older head ${review.head.slice(0, 7)}; verify the finding still applies before changing code.` : "";
  for (const [owner, owned] of byOwner) {
    const role = config.roles.find((role) => role.id === owner);
    if (!role) throw new Error(`No configured role for fix owner ${owner}.`);
    newTasks.push({
      id: `fix-${round}-${owner}`, title: `Address Crewbie review fixes for ${owner}`,
      body: taskBody(owner, owned, notes, stale, commentId), owner, model: role.model, priority: 1,
      dependsOn: conflictId ? [conflictId] : [],
    });
  }
  const batch: Batch = approvedBatch({ schemaVersion: 1, id: feature.batch, spec: `Follow-up fixes requested on feature PR #${number}.`, sources: tasks[0]!.metadata.sources, tasks: newTasks, approval: null }, true);
  const created = await publishFixTasks(client, config, batch, digest, feature.branch, newTasks);
  if (priorReceipt && created.length === priorReceipt.issues.length && created.every((item) => priorReceipt.issues.includes(item.issue))
    && priorReceipt.issues.every((issue) => new RegExp(`\\bCloses\\s+#${issue}\\b`, "i").test(String(pull.body ?? "")))) {
    return `Fix request comment ${commentId} was already handled for ${priorReceipt.issues.map((id) => `#${id}`).join(", ") || "no new tasks"}.`;
  }
  const allItems: FeatureBodyItem[] = [...tasks, ...created.map((item) => ({
    issue: { number: item.issue, title: newTasks.find((task) => task.id === item.task)?.title ?? item.task },
    metadata: { batch: feature.batch, batchDigest: digest, branch: feature.branch, sources: tasks[0]!.metadata.sources, task: newTasks.find((task) => task.id === item.task)! },
  }))];
  const nextBody = updateFeatureBody(config, feature.batch, allItems, String(pull.body ?? ""));
  if (String(pull.body ?? "") !== nextBody) await client.request("PATCH", `/repos/${config.repository}/pulls/${number}`, { body: nextBody });
  await client.request("POST", `/repos/${config.repository}/actions/workflows/crewbie-dispatch.yml/dispatches`, {
    ref: defaultBranch, inputs: { issue_numbers: created.map((item) => item.issue).join(",") },
  });
  const summary = [
    `Crewbie created ${created.length} fix task(s): ${created.map((item) => `#${item.issue} for crewbie-${item.owner}`).join(", ")}.`,
    sync === "conflict" ? `The feature branch conflicts with ${defaultBranch}; fix tasks wait for the conflict-resolution task.` : sync === "current" ? `The feature branch was already up to date with ${defaultBranch}.` : `Merged ${defaultBranch} into ${feature.branch} before creating fix tasks.`,
    review && review.head !== string(record(pull.head, "PR head").sha, "PR head SHA") ? `The latest trusted changes-requested review was for older head ${review.head.slice(0, 7)}.` : "",
  ].filter(Boolean).join(" ");
  await postReceipt(client, config, number, commentId, created.map((item) => item.issue), summary);
  return summary;
}

async function postReceipt(client: GitHubApi, config: Config, pr: number, comment: number, issues: number[], summary: string): Promise<void> {
  const receipt = Buffer.from(JSON.stringify({ comment, pr, issues })).toString("base64");
  await client.request("POST", `/repos/${config.repository}/issues/${pr}/comments`, { body: `<!-- crewbie-fix:${receipt} -->\n${summary}` });
}
