import { execFileSync } from "node:child_process";
import { GitHubError, integer, record, string } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { cloudTasks } from "../tracking/native.js";

export interface PrUsage {
  sessions: number; measuredSessions: number; inputTokens: number | null; outputTokens: number | null;
  credits: null; sources: string[]; warnings: string[];
}
export class UsageUnavailable extends Error {}

export function parseUsageLog(log: string): { sessionId: string; inputTokens: number; outputTokens: number } | null {
  const sessions = new Set([...log.matchAll(/\bCOPILOT_AGENT_SESSION_ID:\s*([a-f0-9-]{36})\b/g)].map((match) => match[1]!));
  if (sessions.size !== 1) return null;
  const turns = new Map<string, { input: number; output: number }>();
  for (const match of log.matchAll(/\[cca-engine\] turn=(\d+) assistant\.usage: model=\S+ input=(\d+) output=(\d+)(?=\s|$)/g)) {
    const value = { input: integer(Number(match[2]), "input tokens", 0, Number.MAX_SAFE_INTEGER), output: integer(Number(match[3]), "output tokens", 0, Number.MAX_SAFE_INTEGER) };
    const prior = turns.get(match[1]!);
    if (prior && (prior.input !== value.input || prior.output !== value.output)) return null;
    turns.set(match[1]!, value);
  }
  if (!turns.size) return null;
  if ([...turns.keys()].some((turn) => Number(turn) < 1 || Number(turn) > turns.size)) return null;
  const total = [...turns.values()].reduce((sum, turn) => ({ input: sum.input + turn.input, output: sum.output + turn.output }), { input: 0, output: 0 });
  if (!Number.isSafeInteger(total.input) || !Number.isSafeInteger(total.output)) throw new Error("Token totals exceed safe integer limits.");
  return { sessionId: [...sessions][0]!, inputTokens: total.input, outputTokens: total.output };
}

function actionsLog(repository: string, runId: number): string {
  try {
    return execFileSync("gh", ["run", "view", String(runId), "--repo", repository, "--log"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 8_000_000, windowsHide: true,
    });
  } catch {
    throw new UsageUnavailable("Actions logs could not be read within the time/size limit; check gh access and log retention.");
  }
}

export async function collectPrUsage(client: GitHubApi, repository: string, pr: Record<string, unknown>, readLog = actionsLog): Promise<PrUsage> {
  const result: PrUsage = { sessions: 0, measuredSessions: 0, inputTokens: null, outputTokens: null, credits: null, sources: [], warnings: [] };
  try {
    const native = await cloudTasks(client, repository);
    if (native.warning) { result.warnings.push(native.warning); return result; }
    const sessions = new Set<string>();
    for (const task of native.tasks) {
      if (!Array.isArray(task.artifacts) || !task.artifacts.some((raw) => {
        const artifact = record(raw, "task artifact");
        return artifact.provider === "github" && artifact.type === "pull" && record(artifact.data, "pull artifact").id === pr.id;
      })) continue;
      const id = string(task.id, "task ID");
      if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid native task ID.");
      const detail = record(await client.request("GET", `/agents/repos/${repository}/tasks/${id}`), "native task");
      if (!Array.isArray(detail.sessions)) { result.warnings.push("Native session detail is unavailable."); continue; }
      if (detail.session_count !== detail.sessions.length) result.warnings.push("Native session coverage is incomplete.");
      for (const raw of detail.sessions) {
        const session = record(raw, "native session");
        const sessionId = string(session.id, "session ID");
        if (sessions.has(sessionId)) throw new Error("Duplicate native session would double-count usage.");
        sessions.add(sessionId);
      }
    }
    result.sessions = sessions.size;
    if (!sessions.size) { result.warnings.push("No attributable native sessions found."); return result; }
    const measured = new Set<string>(), runs = new Set<number>();
    const head = string(record(pr.head, "PR head").ref, "PR branch");
    for (let page = 1; page <= 100; page++) {
      const response = record(await client.request("GET", `/repos/${repository}/actions/runs?event=dynamic&branch=${encodeURIComponent(head)}&per_page=100&page=${page}`), "Actions runs");
      if (!Array.isArray(response.workflow_runs)) throw new Error("Actions returned invalid run coverage.");
      for (const raw of response.workflow_runs) {
        const run = record(raw, "Actions run");
        if (!Array.isArray(run.pull_requests) || !run.pull_requests.some((pull) => record(pull, "run pull request").id === pr.id)) continue;
        const id = integer(run.id, "Actions run");
        if (runs.has(id)) throw new Error("Actions pagination repeated a run.");
        runs.add(id);
        if (run.status !== "completed") continue;
        let usage: ReturnType<typeof parseUsageLog>;
        try { usage = parseUsageLog(readLog(repository, id)); }
        catch (error) {
          if (!(error instanceof UsageUnavailable)) throw error;
          result.warnings.push(error.message); continue;
        }
        if (!usage || !sessions.has(usage.sessionId)) { result.warnings.push(`Run ${id} has no verifiable session-token record.`); continue; }
        if (measured.has(usage.sessionId)) { result.warnings.push("Multiple runs reference one session; repeated session usage was excluded."); continue; }
        measured.add(usage.sessionId);
        result.measuredSessions = measured.size;
        result.inputTokens = (result.inputTokens ?? 0) + usage.inputTokens;
        result.outputTokens = (result.outputTokens ?? 0) + usage.outputTokens;
        if (!Number.isSafeInteger(result.inputTokens + result.outputTokens)) throw new Error("PR token totals exceed safe integer limits.");
        result.sources.push(`https://github.com/${repository}/actions/runs/${id}`);
      }
      if (response.workflow_runs.length < 100) break;
      if (page === 100) result.warnings.push("Actions run coverage exceeded the pagination bound.");
    }
    if (measured.size !== sessions.size) result.warnings.push("Some native sessions have missing, unsupported or pending logs.");
    result.warnings.push("AI-credit amount scaling is undocumented in the task API; credits are not inferred from tokens or legacy multipliers.");
    return result;
  } catch (error) {
    if (error instanceof GitHubError && [403, 404, 410].includes(error.status)) {
      result.warnings.push(`Usage coverage is unavailable (HTTP ${error.status}).`);
      return result;
    }
    throw error;
  }
}

export function renderPrUsage(usage: PrUsage): string {
  const tokens = usage.inputTokens === null || usage.outputTokens === null ? "unavailable"
    : `${usage.inputTokens + usage.outputTokens} (${usage.inputTokens} input + ${usage.outputTokens} output)`;
  return `**Observed tokens:** ${tokens}; ${usage.sessions ? `${usage.measuredSessions}/${usage.sessions} known sessions` : "session coverage unavailable"}. **AI credits:** unavailable (API scaling unverified). Main-session log counts, not an invoice or unique-context count; unreported subagent/tool usage is excluded.${usage.sources.length ? ` [Evidence](${usage.sources[0]})` : ""}${usage.warnings.some((warning) => !warning.startsWith("AI-credit")) ? " Coverage incomplete; inspect session logs." : ""}`;
}
