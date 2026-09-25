import type { Config } from "../config.js";
import { GitHubError, integer, record, string } from "../core.js";
import { taskMetadata } from "../specification/batch.js";
import { requireWriter, type GitHubApi } from "../tracking/github.js";
import { linkedPull } from "./dispatch.js";
import { withDispatchLock } from "./controls.js";

export async function cancelRun(client: GitHubApi, config: Config, issueNumber: number, runId: number, apply: boolean): Promise<string> {
  integer(issueNumber, "issue"); integer(runId, "run ID");
  const prefix = `/repos/${config.repository}`;
  const inspect = async () => {
    const issue = record(await client.request("GET", `${prefix}/issues/${issueNumber}`), "execution issue");
    const metadata = taskMetadata(string(issue.body, "issue body"));
    if (!metadata) throw new Error("Cancellation requires a Crewbie execution issue.");
    const pr = await linkedPull(client, config.repository, issueNumber, metadata.branch);
    if (!pr) throw new Error("No unambiguous linked Copilot PR. Use GitHub's session viewer to stop the session manually.");
    const run = record(await client.request("GET", `${prefix}/actions/runs/${runId}`), "agent run");
    const head = record(pr.head, "PR head");
    if (run.event !== "dynamic" || record(run.repository, "run repository").full_name !== config.repository
      || record(head.repo, "PR repository").full_name !== config.repository || run.head_branch !== head.ref
      || !Array.isArray(run.pull_requests) || !run.pull_requests.some((raw) => record(raw, "run PR").id === pr.id)) {
      throw new Error("Run is not an attributable cloud-agent run for this issue. No cancellation requested.");
    }
    return run;
  };
  const run = await inspect();
  const url = `https://github.com/${config.repository}/actions/runs/${runId}`;
  if (run.status === "completed") return `Run already completed (${String(run.conclusion)}). Nothing cancelled; inspect preserved work. ${url}`;
  if (!apply) return `Preview: request cancellation of cloud-agent run ${runId} for issue #${issueNumber}. Commits, approvals and consumed launch allowances remain. This does not pause future launches. ${url}\nRepeat with --apply.`;
  await requireWriter(client, config.repository);
  return withDispatchLock(client, config, async () => {
    const fresh = await inspect();
    if (fresh.status === "completed") return "Run completed before cancellation; nothing cancelled.";
    if (fresh.run_attempt !== run.run_attempt) throw new Error("Run attempt changed; preview cancellation again.");
    try { await client.request("POST", `${prefix}/actions/runs/${runId}/cancel`); }
    catch (error) {
      const reason = error instanceof GitHubError ? `HTTP ${error.status}` : error instanceof Error ? error.message : "unknown request outcome";
      throw new Error(`Cancellation was not confirmed (${reason}); inspect the run before retrying. This backend or credential may not support it. Use Stop session in GitHub's session viewer. No force-cancel, replacement or refund was attempted. ${url}`);
    }
    let result: Record<string, unknown>;
    try { result = record(await client.request("GET", `${prefix}/actions/runs/${runId}`), "cancellation status"); }
    catch (error) { throw new Error(`Cancellation requested, but verification failed. Inspect ${url} before retrying. ${error instanceof Error ? error.message : "Status unavailable."}`); }
    return result.status === "completed" && result.conclusion === "cancelled"
      ? `Actions run cancellation confirmed. Commits and launch claims are preserved; verify native session termination before replacement. ${url}`
      : `Cancellation requested, not confirmed. Do not assume the agent has stopped or spending has ended. Inspect ${url}; no replacement was started.`;
  });
}
