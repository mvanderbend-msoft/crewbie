import { hash, integer, record, string } from "../core.js";
import type { Config } from "../config.js";
import type { SourceReference } from "../specification/batch.js";
import type { GitHubApi } from "./github.js";
import { importWorkItem, type AdoApi } from "./ado.js";

export async function verifySources(sources: SourceReference[], github: GitHubApi, config: Config, ado?: AdoApi): Promise<void> {
  for (const source of sources) {
    const gh = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)$/.exec(source.uri);
    if (gh) {
      const issue = record(await github.request("GET", `/repos/${gh[1]}/issues/${gh[2]}`), "source issue");
      const content = `${string(issue.title, "source title")}\n\n${typeof issue.body === "string" ? issue.body : ""}`;
      const matches = source.fingerprint ? source.fingerprint === hash(content) : source.revision === issue.updated_at;
      if (!matches) throw new Error(`Source changed: ${source.uri}. Reconcile and approve the batch again.`);
    } else if (source.uri.startsWith("https://dev.azure.com/")) {
      if (!config.ado || !ado) throw new Error("ADO source verification requires the configured integration and credential.");
      const url = new URL(source.uri);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts.length !== 5 || parts[0] !== config.ado.organization || parts[1] !== config.ado.project || parts[2] !== "_workitems" || parts[3] !== "edit") {
        throw new Error("ADO source must match the configured organization and project.");
      }
      const current = await importWorkItem(ado, config.ado, integer(Number(parts[4]), "source work item"));
      const matches = source.fingerprint ? current.fingerprint === source.fingerprint : current.revision === source.revision;
      if (!matches) throw new Error(`ADO requirements changed: ${source.uri}. Reconcile and reapprove; no source fields were overwritten.`);
    }
    // Other inputs are approved text snapshots, not continuously synchronized trackers.
  }
}
