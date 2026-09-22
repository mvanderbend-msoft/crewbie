import { hash, integer, record, string } from "../core.js";
import type { Config } from "../config.js";
import { isApprover, type GitHubApi } from "../tracking/github.js";
import { managedIssues } from "../tracking/issues.js";
import { taskMetadata } from "../specification/batch.js";
import { linkedPull } from "../execution/dispatch.js";

export interface RunRecord {
  schemaVersion: 1;
  kind: "work-item" | "session" | "improvement-review";
  sessionId: string | null;
  contextStatus: "unreported" | "attested";
  id: string; specialist: string; requestedModel: string; observedModel: string | null;
  observedModelSource: string | null; date: string; status: string; issue: string;
  pullRequest: string | null; inputTokens: number | null; outputTokens: number | null;
  credits: number | null; currencyAmount: number | null; currency: string | null;
  usageSource: string | null; summary: string;
}
function metric(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative or null.`);
  return value;
}
function nullable(value: unknown, name: string): string | null {
  return value === null || value === undefined ? null : string(value, name);
}
export function runRecord(value: unknown): RunRecord {
  const data = record(value, "run");
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) throw new Error("Unsupported run-record version.");
  if (data.kind !== undefined && !["session", "work-item", "improvement-review"].includes(String(data.kind))) throw new Error("Invalid record kind.");
  if (data.contextStatus !== undefined && !["unreported", "attested"].includes(String(data.contextStatus))) throw new Error("Memory-read evidence must be unreported or explicitly attested.");
  const result: RunRecord = {
    schemaVersion: 1,
    kind: data.kind === "session" ? "session" : data.kind === "improvement-review" ? "improvement-review" : "work-item",
    sessionId: nullable(data.sessionId, "session ID"),
    contextStatus: data.contextStatus === "attested" ? "attested" : "unreported",
    id: string(data.id, "run ID"), specialist: string(data.specialist, "specialist"),
    requestedModel: string(data.requestedModel, "requested model"),
    observedModel: nullable(data.observedModel, "observed model"),
    observedModelSource: nullable(data.observedModelSource, "observed-model evidence"),
    date: string(data.date, "date"), status: string(data.status, "status"),
    issue: string(data.issue, "issue"), pullRequest: nullable(data.pullRequest, "PR"),
    inputTokens: metric(data.inputTokens, "input tokens"), outputTokens: metric(data.outputTokens, "output tokens"),
    credits: metric(data.credits, "credits"), currencyAmount: metric(data.currencyAmount, "currency amount"),
    currency: nullable(data.currency, "currency"), usageSource: nullable(data.usageSource, "usage evidence"),
    summary: string(data.summary, "summary", true),
  };
  if (!Number.isFinite(Date.parse(result.date))) throw new Error("Invalid run date.");
  result.date = new Date(result.date).toISOString();
  if (result.kind === "session" && !result.sessionId) throw new Error("A session record needs a real session identifier.");
  for (const count of [result.inputTokens, result.outputTokens]) if (count !== null && !Number.isSafeInteger(count)) throw new Error("Token counts must be whole safe integers.");
  if (result.observedModel !== null && !result.observedModelSource) throw new Error("Observed model requires runtime evidence, not an agent's assertion.");
  if ([result.inputTokens, result.outputTokens, result.credits, result.currencyAmount].some((value) => value !== null) && !result.usageSource) throw new Error("Reported usage needs an evidence source.");
  if (result.currencyAmount !== null && !result.currency) throw new Error("Currency amount requires its currency.");
  if (result.summary.length > 4000) throw new Error("Run summaries must remain compact.");
  return result;
}
export async function collectRecords(client: GitHubApi, config: Config): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const issue of await managedIssues(client, config.repository)) {
    const metadata = taskMetadata(String(issue.body ?? ""));
    if (!metadata) continue;
    const number = integer(issue.number, "issue number");
    const pr = await linkedPull(client, config.repository, number);
    let date = string(pr?.updated_at ?? issue.updated_at, "updated timestamp");
    const evidence: string[] = [];
    if (pr) {
      const comments = await client.list(`/repos/${config.repository}/issues/${integer(pr.number, "PR number")}/comments`);
      for (const comment of comments) {
        const user = comment.user === null || comment.user === undefined ? null : record(comment.user, "comment author");
        const trusted = isApprover(user, config.approvers) || (user?.type === "Bot" && ["Copilot", "copilot-swe-agent[bot]"].includes(String(user.login)));
        const body = typeof comment.body === "string" ? comment.body : "";
        if (!trusted || !body.trimStart().startsWith("<!-- crewbie-memory-proposal -->")) continue;
        if (typeof comment.updated_at === "string" && comment.updated_at > date) date = comment.updated_at;
        const link = `https://github.com/${config.repository}/pull/${pr.number}#issuecomment-${comment.id}`;
        evidence.push(`Deferred memory proposal (${link}): ${body.length <= 1000 ? body : "Body omitted because it exceeds the summary budget; consult the comment."}`);
      }
      const reviews = await client.list(`/repos/${config.repository}/pulls/${integer(pr.number, "PR number")}/reviews`);
      for (const review of reviews) {
        if (review.state === "DISMISSED") continue;
        if (typeof review.submitted_at === "string" && review.submitted_at > date) date = review.submitted_at;
        const body = typeof review.body === "string" ? review.body : "";
        evidence.push(`Review ${review.id}: ${review.state}. ${body.length <= 1000 ? body : "Body omitted because it exceeds the summary budget; consult the review."}`);
      }
      const head = record(pr.head, "PR head");
      const checks = record(await client.request("GET", `/repos/${config.repository}/commits/${encodeURIComponent(string(head.sha, "head revision"))}/check-runs?per_page=100`), "check runs");
      if (!Array.isArray(checks.check_runs)) throw new Error("GitHub returned invalid CI results.");
      for (const raw of checks.check_runs) {
        const check = record(raw, "check run");
        if (typeof check.completed_at === "string" && check.completed_at > date) date = check.completed_at;
        evidence.push(`CI ${String(check.name)}: ${String(check.conclusion ?? check.status)}.`);
      }
      if (typeof checks.total_count === "number" && checks.total_count > checks.check_runs.length) evidence.push("Additional CI results are not included; consult the PR.");
    }
    const primary = String(pr?.body ?? issue.title ?? "");
    let summary = [primary.length <= 2500 ? primary : "PR body omitted because it exceeds the summary budget; consult the PR.", ...evidence].join("\n");
    if (summary.length > 4000) summary = "Detailed feedback exceeds the compact record budget. Review the linked issue/PR, reviews and CI before proposing changes.";
    records.push(runRecord({
      id: `${config.repository}#${number}`, specialist: metadata.task.owner, requestedModel: metadata.task.model,
      date,
      status: pr?.merged_at ? "merged" : pr?.state === "closed" ? "failed" : pr ? "review" : issue.state === "closed" ? "closed-unmerged" : "pending",
      issue: `https://github.com/${config.repository}/issues/${number}`,
      pullRequest: pr ? `https://github.com/${config.repository}/pull/${integer(pr.number, "PR number")}` : null,
      observedModel: null, observedModelSource: null, inputTokens: null, outputTokens: null,
      credits: null, currencyAmount: null, currency: null, usageSource: null,
      summary,
    }));
  }
  const improvements = await client.list(`/repos/${config.repository}/pulls?state=closed&head=${config.repository.split("/")[0]}:crewbie/improvements`);
  for (const pull of improvements) {
    const number = integer(pull.number, "improvement PR");
    const comments = await client.list(`/repos/${config.repository}/issues/${number}/comments`);
    const feedback = comments.filter((comment) => isApprover(comment.user, config.approvers))
      .map((comment) => typeof comment.body === "string" ? comment.body : "").filter(Boolean).join("\n");
    records.push(runRecord({
      id: `${config.repository}:improvement#${number}`, kind: "improvement-review", specialist: "improver",
      requestedModel: "Unrecorded", date: string(pull.closed_at, "closed timestamp"),
      status: pull.merged_at ? "proposal-accepted" : "closed-unmerged",
      issue: `https://github.com/${config.repository}/pull/${number}`,
      pullRequest: `https://github.com/${config.repository}/pull/${number}`,
      summary: feedback.length <= 3000 ? `Human review outcome: ${pull.merged_at ? "merged" : "closed without merge; the reason is not inferred"}.\n${feedback}` : "Human feedback exceeds the compact record budget. Consult the linked improvement PR.",
    }));
  }
  return records;
}
export function evidenceId(run: RunRecord): string {
  return hash(JSON.stringify({ id: run.id, date: run.date, status: run.status, summary: run.summary }));
}
export function parseRecords(value: unknown): RunRecord[] {
  if (!Array.isArray(value)) throw new Error("Run records must be a list.");
  const records = value.map(runRecord);
  if (new Set(records.map((run) => run.id)).size !== records.length) throw new Error("Duplicate run IDs would double-count usage.");
  const sessions = records.flatMap((run) => run.sessionId ? [run.sessionId] : []);
  if (new Set(sessions).size !== sessions.length) throw new Error("Duplicate session IDs would double-count usage.");
  return records;
}
