import type { Config } from "../config.js";
import { integer, record, string, words } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { memoryLimit } from "./context.js";

export interface MemoryBudget { path: string; words: number; limit: number }

/**
 * Word budgets of the memory files a PR adds or changes, read at its head. Cloud agents edit memory on their
 * branch where Crewbie's local budget check never runs; without this, hot memory grows past its budget unseen.
 */
export async function prMemoryBudgets(client: GitHubApi, config: Config, pr: Record<string, unknown>): Promise<MemoryBudget[]> {
  const number = integer(pr.number, "PR number");
  const head = string(record(pr.head, "PR head").sha, "PR head SHA");
  const result: MemoryBudget[] = [];
  for (const raw of await client.list(`/repos/${config.repository}/pulls/${number}/files`)) {
    const path = string(raw.filename, "changed file");
    const limit = memoryLimit(config, path);
    if (limit === null || raw.status === "removed") continue;
    const file = record(await client.request("GET", `/repos/${config.repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${head}`), "memory file");
    // Files over 1 MB come back without inline content; they are over any word budget.
    const text = file.encoding === "base64" && typeof file.content === "string" ? Buffer.from(file.content, "base64").toString("utf8") : null;
    result.push({ path, words: text === null ? Number.MAX_SAFE_INTEGER : words(text), limit });
  }
  return result;
}

export function overBudget(budgets: MemoryBudget[]): string | null {
  const over = budgets.filter((budget) => budget.words > budget.limit);
  if (!over.length) return null;
  return `Memory over its word budget: ${over.map((budget) => `${budget.path} (${budget.words === Number.MAX_SAFE_INTEGER ? "too large to read" : budget.words}/${budget.limit} words)`).join(", ")}. This does not block the PR: Crewbie moves the oldest hot entries to a linked cold topic at the next launch on the feature branch.`;
}
