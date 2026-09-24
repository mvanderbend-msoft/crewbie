import { GitHubError, record, string } from "../core.js";
import type { GitHubApi } from "./github.js";

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
