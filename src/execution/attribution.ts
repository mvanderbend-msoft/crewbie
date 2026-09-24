import type { Config } from "../config.js";
import { integer, record, string } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { collectPrUsage, renderPrUsage } from "../reporting/pr-usage.js";

export function attributedBody(body: string, specialist: string, model: string, taskUrl: string, issue?: number, usage?: string): string {
  const start = "<!-- crewbie-attribution -->", end = "<!-- /crewbie-attribution -->";
  const blocks = [...body.matchAll(/<!-- crewbie-attribution -->[\s\S]*?<!-- \/crewbie-attribution -->/g)];
  if (blocks.length > 1 || (body.includes(start) !== body.includes(end)) || (body.includes(start) && !blocks.length)) {
    throw new Error("PR attribution markers are ambiguous; reconcile the description.");
  }
  const attribution = `${start}\n**Specialist:** \`${specialist}\` | **Requested model:** \`${model}\`\n[GitHub-confirmed specialist task](${taskUrl})${issue === undefined ? "" : `\nCloses #${integer(issue, "execution issue")}`}${usage ? `\n\n${usage}` : ""}\n${end}`;
  return blocks[0] ? body.replace(blocks[0][0], attribution) : `${attribution}\n\n${body}`;
}

export async function attributePull(client: GitHubApi, config: Config, pr: Record<string, unknown>, task: Record<string, unknown>, owner: string, model: string, issue?: number): Promise<void> {
  const profile = `crewbie-${owner}`;
  if (!task.custom_agent || record(task.custom_agent, "native profile").id !== profile) {
    throw new Error(`PR #${pr.number}: GitHub did not confirm ${profile}; attribution was not invented.`);
  }
  const id = string(task.id, "native task ID");
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid native task ID.");
  const number = integer(pr.number, "PR number");
  const body = typeof pr.body === "string" ? pr.body : "";
  const usage = typeof task.session_count === "number" ? renderPrUsage(await collectPrUsage(client, config.repository, pr))
    : "**Observed tokens:** unavailable. **AI credits:** unavailable. Native session metadata was not exposed.";
  let note: string | null = null;
  try { note = specialistNote(await prEdits(client, config, number), profile); }
  catch (error) { console.warn(`Crewbie: specialist description for PR #${number} could not be recovered: ${error instanceof Error ? error.message : String(error)}`); }
  const restore = note !== null && note.length <= 60_000 && !body.includes(note);
  const attributed = (text: string) => attributedBody(text, profile, model, `https://github.com/${config.repository}/tasks/${id}`, issue, usage);
  let after = attributed(restore ? restoredBody(note!, body) : body);
  if (after === body) return;
  const path = `/repos/${config.repository}/pulls/${number}`;
  const fresh = record(await client.request("GET", path), "fresh PR");
  if (fresh.body !== pr.body || record(fresh.head, "fresh head").sha !== record(pr.head, "expected head").sha || fresh.state !== "open") {
    throw new Error("PR changed before attribution; reconcile again rather than overwriting it.");
  }
  if (restore) {
    try { await keepCopilotSummary(client, config, number, id, body); }
    catch (error) {
      console.warn(`Crewbie: kept Copilot's summary on PR #${number} because it could not be saved as a comment: ${error instanceof Error ? error.message : String(error)}`);
      after = attributed(body);
      if (after === body) return;
    }
  }
  const updated = record(await client.request("PATCH", path, { body: after }), "updated PR");
  if (updated.body !== after) throw new Error("GitHub did not confirm specialist attribution.");
}

const COPILOT_EDITOR = "copilot-swe-agent";
const SUFFIX = "<!-- START COPILOT CODING AGENT SUFFIX -->";
const ATTRIBUTION = /<!-- crewbie-attribution -->[\s\S]*?<!-- \/crewbie-attribution -->\s*/g;

// The cloud agent's final summary replaces the specialist's own PR description; recover the specialist's last version.
export function specialistNote(edits: readonly { editor: string | null; body: string }[], profile: string): string | null {
  const marker = new RegExp(`^\\s*(?:\\*\\*)?Specialist:(?:\\*\\*)?\\s*\`?${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`?`, "m");
  for (const edit of edits) {
    if (edit.editor !== COPILOT_EDITOR || edit.body.includes("<!-- crewbie-attribution -->") || !marker.test(edit.body)) continue;
    const note = edit.body.split(SUFFIX)[0]!.trim();
    return note.length ? note : null;
  }
  return null;
}

/** The specialist's description replaces Copilot's summary; Copilot's suffix block is kept. */
export function restoredBody(note: string, body: string): string {
  const suffix = body.indexOf(SUFFIX);
  return suffix < 0 ? note : `${note}\n\n${body.slice(suffix)}`;
}

async function prEdits(client: GitHubApi, config: Config, number: number): Promise<{ editor: string | null; body: string }[]> {
  const [owner, name] = config.repository.split("/");
  const result = record(await client.request("POST", "/graphql", {
    query: "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){userContentEdits(first:50){nodes{editor{login} diff}}}}}",
    variables: { owner, name, number },
  }), "PR edit history");
  const nodes = record(record(record(record(result.data, "GraphQL data").repository, "repository").pullRequest, "pull request").userContentEdits, "PR edits").nodes;
  if (!Array.isArray(nodes)) throw new Error("GitHub returned no PR edit history.");
  return nodes.map((raw) => {
    const node = record(raw, "PR edit");
    const editor = node.editor === null ? null : record(node.editor, "PR editor").login;
    return { editor: typeof editor === "string" ? editor : null, body: typeof node.diff === "string" ? node.diff : "" };
  });
}

async function keepCopilotSummary(client: GitHubApi, config: Config, number: number, taskId: string, body: string): Promise<void> {
  const tag = `<!-- crewbie-copilot-summary:${taskId} -->`;
  const comments = await client.list(`/repos/${config.repository}/issues/${number}/comments`);
  if (comments.some((comment) => typeof comment.body === "string" && comment.body.includes(tag))) return;
  const summary = body.split(SUFFIX)[0]!.replace(ATTRIBUTION, "").trim();
  if (!summary) return;
  await client.request("POST", `/repos/${config.repository}/issues/${number}/comments`, {
    body: `${tag}\n**Copilot's final session summary.** Crewbie restored the specialist's own description as the PR body:\n\n${summary.split("\n").map((line) => `> ${line}`).join("\n")}`,
  });
}
