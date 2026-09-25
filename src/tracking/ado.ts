import { hash, integer, record, string } from "../core.js";
import type { Config } from "../config.js";
import type { Batch, Task } from "../specification/batch.js";
import { isWriter, type GitHubApi } from "./github.js";
import type { Work } from "../execution/dispatch.js";
import { linkedPull } from "../execution/dispatch.js";

export interface Source { uri: string; revision: string; text: string; fingerprint: string }
export interface AdoApi { request(method: string, resource: string, body?: unknown, patch?: boolean): Promise<unknown> }
export function adoApi(config: NonNullable<Config["ado"]>, token: string, fetcher: typeof fetch = fetch): AdoApi {
  if (!token.trim()) throw new Error("Set CREWBIE_ADO_TOKEN in a credential store before using ADO.");
  const base = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/_apis/wit`;
  return {
    async request(method, resource, body, patch = false) {
      if (!resource.startsWith("/") || resource.startsWith("//") || resource.includes("://")) throw new Error("Invalid ADO resource.");
      const version = resource.includes("/comments") ? "7.1-preview.4" : "7.1";
      const response = await fetcher(`${base}${resource}${resource.includes("?") ? "&" : "?"}api-version=${version}`, {
        method, headers: {
          Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
          "Content-Type": patch ? "application/json-patch+json" : "application/json",
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`ADO HTTP ${response.status}. Check access and project/type configuration; reconcile unknown write outcomes before retrying.`);
      return response.status === 204 ? null : response.json();
    },
  };
}
export async function importWorkItem(client: AdoApi, config: NonNullable<Config["ado"]>, id: number): Promise<Source> {
  integer(id, "work item ID");
  const item = record(await client.request("GET", `/workitems/${id}`), "ADO work item");
  const fields = record(item.fields, "ADO fields");
  const title = string(fields["System.Title"], "ADO title");
  const description = fields["System.Description"];
  const criteria = fields["Microsoft.VSTS.Common.AcceptanceCriteria"];
  const content = [title, typeof description === "string" ? description : "", typeof criteria === "string" ? criteria : ""].filter(Boolean).join("\n\n");
  return {
    uri: `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/_workitems/edit/${id}`,
    revision: String(integer(item.rev, "ADO revision")),
    text: content, fingerprint: hash(content),
  };
}
function html(text: string): string {
  return `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`;
}
export async function createWorkItem(client: AdoApi, config: NonNullable<Config["ado"]>, batch: Batch, task: Task): Promise<number> {
  const marker = `Crewbie-${hash(`${batch.id}/${task.id}`).slice(0, 24)}`;
  const query = record(await client.request("POST", "/wiql", { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '${marker}'` }), "ADO query");
  if (!Array.isArray(query.workItems)) throw new Error("ADO returned no work item list.");
  if (query.workItems.length > 1) throw new Error(`Multiple ADO work items match ${task.id}. Resolve the mapping before retrying.`);
  if (query.workItems.length === 1) {
    const existing = record(query.workItems[0], "work item reference");
    const id = integer(existing.id, "ADO work item ID");
    const item = record(await client.request("GET", `/workitems/${id}`), "existing ADO item");
    const fields = record(item.fields, "existing ADO fields");
    if (fields["System.Title"] !== task.title || fields["System.Description"] !== html(task.body)) {
      throw new Error(`ADO work item ${id} drifted from the approved task. Reconcile rather than overwrite.`);
    }
    return id;
  }
  const created = record(await client.request("POST", `/workitems/$${encodeURIComponent(config.workItemType)}`, [
    { op: "add", path: "/fields/System.Title", value: task.title },
    { op: "add", path: "/fields/System.Description", value: html(task.body) },
    { op: "add", path: "/fields/System.Tags", value: marker },
  ], true), "created ADO item");
  return integer(created.id, "created work item ID");
}
export async function writeBack(client: AdoApi, id: number, links: string[], message: string): Promise<boolean> {
  integer(id, "work item ID");
  if (links.some((link) => !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+$/.test(link))) {
    throw new Error("Write-back links must be GitHub issue or PR URLs.");
  }

  if (message.length > 2000) throw new Error("Write-back must be concise.");
  const marker = `[Crewbie:${hash(JSON.stringify({ links: [...links].sort(), message })).slice(0, 24)}]`;
  let continuation = "";
  for (let page = 0; page < 100; page++) {
    const response = record(await client.request("GET", `/workitems/${id}/comments?$top=100${continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : ""}`), "ADO comments");
    if (!Array.isArray(response.comments)) throw new Error("ADO returned an invalid comments page.");
    if (response.comments.some((item) => String(record(item, "ADO comment").text ?? "").includes(marker))) return false;
    if (response.continuationToken === undefined || response.continuationToken === null || response.continuationToken === "") {
      await client.request("POST", `/workitems/${id}/comments`, { text: `${message}\n\n${links.join("\n")}\n\n${marker}` });
      return true;
    }
    continuation = string(response.continuationToken, "ADO continuation token");
  }
  throw new Error("ADO comment pagination exceeded the safety limit; no comment was posted.");
}

export async function linkAdo(github: GitHubApi, config: Config, issue: number, workItem: number): Promise<void> {
  if (!config.ado) throw new Error("ADO is not configured.");
  const body = `Crewbie ADO: ${config.ado.organization}/${config.ado.project}#${workItem}`;
  const path = `/repos/${config.repository}/issues/${issue}/comments`;
  const comments = await github.list(path);
  let exists = false;
  for (const comment of comments) if (comment.body === body && await isWriter(github, config.repository, comment.user)) exists = true;
  if (!exists) {
    await github.request("POST", path, { body });
  }
}
export async function syncAdo(github: GitHubApi, ado: AdoApi, config: Config, work: Work[]): Promise<void> {
  if (!config.ado) throw new Error("ADO is not configured.");
  for (const item of work) {
    const issue = integer(item.issue.number, "issue number");
    const comments = await github.list(`/repos/${config.repository}/issues/${issue}/comments`);
    const prefix = `Crewbie ADO: ${config.ado.organization}/${config.ado.project}#`;
    const links = [];
    for (const comment of comments) {
      if (typeof comment.body === "string" && comment.body.startsWith(prefix) && await isWriter(github, config.repository, comment.user)) links.push(comment);
    }
    const ids = [...new Set(links.map((comment) => integer(Number(String(comment.body).slice(prefix.length)), "linked ADO ID")))];
    if (ids.length > 1) throw new Error(`Issue #${issue} has conflicting ADO links. Reconcile them before write-back.`);
    if (!ids[0]) continue;
    const urls = [`https://github.com/${config.repository}/issues/${issue}`];
    const pr = await linkedPull(github, config.repository, issue, item.metadata.branch);
    if (pr) urls.push(`https://github.com/${config.repository}/pull/${integer(pr.number, "PR number")}`);
    await writeBack(ado, ids[0], urls, `Crewbie status: ${item.state}. ${item.reason}`);
  }
}
