import { GitHubError, record, string } from "../core.js";
import type { GitHubApi } from "./github.js";

/**
 * Crewbie's ledger refs (claims, launches, pause, dispatch lock) live under refs/crewbie/, outside refs/heads and
 * refs/tags, so creating them never fires a repository's `on: push` workflows. Releases before 0.1.0-alpha.44 wrote
 * them as tags; those legacy refs are still read so existing claims and launch allowances keep counting.
 */
const ROOT = "crewbie";
const LEGACY = "tags/crewbie";

export interface LedgerRef { name: string; ref: string; object?: Record<string, unknown> }

/** Full ref for a ledger entry, e.g. ledgerRef("claims/3") === "refs/crewbie/claims/3". */
export function ledgerRef(name: string): string { return `refs/${ROOT}/${name}`; }

export async function listLedger(client: GitHubApi, repository: string, prefix: string): Promise<LedgerRef[]> {
  const entries: LedgerRef[] = [];
  for (const root of [ROOT, LEGACY]) {
    const refs = await client.request("GET", `/repos/${repository}/git/matching-refs/${root}/${prefix}`);
    if (!Array.isArray(refs)) throw new Error("GitHub returned an invalid Crewbie ref ledger.");
    for (const raw of refs) {
      const item = record(raw, "ledger ref");
      const ref = string(item.ref, "ledger ref name");
      if (!ref.startsWith(`refs/${root}/${prefix}`)) throw new Error(`Unexpected Crewbie ledger ref: ${ref}`);
      entries.push({ name: ref.slice(`refs/${root}/`.length), ref, ...(item.object === undefined ? {} : { object: record(item.object, "ledger ref object") }) });
    }
  }
  return entries;
}

export async function ledgerHas(client: GitHubApi, repository: string, name: string): Promise<boolean> {
  for (const root of [ROOT, LEGACY]) {
    try { await client.request("GET", `/repos/${repository}/git/ref/${root}/${name}`); return true; }
    catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
  }
  return false;
}

/** Atomically creates a ledger ref; GitHub answers 422 when it already exists. */
export async function createLedger(client: GitHubApi, repository: string, name: string, sha: string): Promise<void> {
  await client.request("POST", `/repos/${repository}/git/refs`, { ref: ledgerRef(name), sha });
}

/** Deletes the ledger ref; with legacy, deletes whichever of the current and legacy refs exist. */
export async function deleteLedger(client: GitHubApi, repository: string, name: string, legacy = false): Promise<void> {
  for (const root of legacy ? [ROOT, LEGACY] : [ROOT]) {
    try { await client.request("DELETE", `/repos/${repository}/git/refs/${root}/${name}`); }
    catch (error) { if (!legacy || !(error instanceof GitHubError && [404, 422].includes(error.status))) throw error; }
  }
}
