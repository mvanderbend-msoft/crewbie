import type { Config } from "../config.js";
import { integer, record, string } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";

export function attributedBody(body: string, specialist: string, model: string, taskUrl: string, issue?: number): string {
  const start = "<!-- crewbie-attribution -->", end = "<!-- /crewbie-attribution -->";
  const blocks = [...body.matchAll(/<!-- crewbie-attribution -->[\s\S]*?<!-- \/crewbie-attribution -->/g)];
  if (blocks.length > 1 || (body.includes(start) !== body.includes(end)) || (body.includes(start) && !blocks.length)) {
    throw new Error("PR attribution markers are ambiguous; reconcile the description.");
  }
  const attribution = `${start}\n**Specialist:** \`${specialist}\` | **Requested model:** \`${model}\`\n[GitHub-confirmed specialist task](${taskUrl})${issue === undefined ? "" : `\nCloses #${integer(issue, "execution issue")}`}\n${end}`;
  return blocks[0] ? body.replace(blocks[0][0], attribution) : `${attribution}\n\n${body}`;
}

export async function attributePull(client: GitHubApi, config: Config, pr: Record<string, unknown>, task: Record<string, unknown>, owner: string, model: string, issue?: number): Promise<void> {
  const profile = `crewbie-${owner}`;
  if (!task.custom_agent || record(task.custom_agent, "native profile").id !== profile) {
    throw new Error(`PR #${pr.number}: GitHub did not confirm ${profile}; attribution was not invented.`);
  }
  const id = string(task.id, "native task ID");
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid native task ID.");
  const body = typeof pr.body === "string" ? pr.body : "";
  const after = attributedBody(body, profile, model, `https://github.com/${config.repository}/tasks/${id}`, issue);
  if (after === body) return;
  const path = `/repos/${config.repository}/pulls/${integer(pr.number, "PR number")}`;
  const fresh = record(await client.request("GET", path), "fresh PR");
  if (fresh.body !== pr.body || record(fresh.head, "fresh head").sha !== record(pr.head, "expected head").sha || fresh.state !== "open") {
    throw new Error("PR changed before attribution; reconcile again rather than overwriting it.");
  }
  const updated = record(await client.request("PATCH", path, { body: after }), "updated PR");
  if (updated.body !== after) throw new Error("GitHub did not confirm specialist attribution.");
}
