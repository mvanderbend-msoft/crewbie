import { GitHubError, record, string } from "../core.js";
import type { GitHubApi } from "./github.js";

/** IDs of the cloud tasks whose artifact is this PR, sorted. */
export function pullTaskIds(tasks: Record<string, unknown>[], pr: Record<string, unknown>): string[] {
  return tasks.filter((task) => Array.isArray(task.artifacts) && task.artifacts.some((raw) => {
    const artifact = record(raw, "artifact");
    return artifact.provider === "github" && artifact.type === "pull" && artifact.data !== undefined && record(artifact.data, "artifact data").id === pr.id;
  })).map((task) => string(task.id, "task ID")).sort();
}

const ENDED = new Set(["completed", "failed", "timed_out", "cancelled"]);

/**
 * Copilot requests review when its session finishes, but the task API can report the
 * session as active for a little longer. Waits until every session on this PR has ended,
 * so dispatch triggered by that review request sees the finished session. Returns false
 * on timeout; dispatch then treats the session as running, as before.
 */
export async function awaitPullSessions(client: GitHubApi, repo: string, prId: number,
  { timeoutMs = 120_000, intervalMs = 10_000, sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) } = {}): Promise<boolean> {
  for (let waited = 0; ; waited += intervalMs) {
    const { tasks, warning } = await cloudTasks(client, repo);
    if (warning) return false;
    const ids = new Set(pullTaskIds(tasks, { id: prId }));
    if (tasks.every((task) => !ids.has(String(task.id)) || ENDED.has(String(task.state)))) return true;
    if (waited + intervalMs > timeoutMs) return false;
    await sleep(intervalMs);
  }
}

export async function cloudTasks(client: GitHubApi, repo: string): Promise<{ tasks: Record<string, unknown>[]; warning: string | null }> {
  const tasks: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  try {
    for (let page = 1; page <= 100; page++) {
      const response = record(await client.request("GET", `/agents/repos/${repo}/tasks?per_page=100&page=${page}`), "cloud tasks");
      if (!Array.isArray(response.tasks)) throw new Error("GitHub returned invalid cloud task telemetry.");
      for (const raw of response.tasks) {
        const task = record(raw, "cloud task");
        const id = string(task.id, "cloud task ID");
        if (ids.has(id)) throw new Error("Cloud task pagination did not advance; session capacity remains unverified.");
        ids.add(id); tasks.push(task);
      }
      if (response.tasks.length < 100) return { tasks, warning: null };
    }
    throw new Error("Cloud task pagination exceeded the safety limit; inspect session capacity before dispatch.");
  } catch (error) {
    if (error instanceof GitHubError && [403, 404].includes(error.status)) {
      return { tasks: [], warning: `Cloud session status is unavailable (HTTP ${error.status}); capacity remains reserved.` };
    }
    throw error;
  }
}
