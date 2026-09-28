import { integer, record, string } from "../core.js";
import type { GitHubApi } from "../tracking/github.js";
import { attributedTokens } from "../execution/controls.js";

/**
 * With/without-guidance evaluation. Two sandbox repositories run the same approved plan: the guided arm keeps its
 * guidance and memory, the bare arm has them removed. Comparing outcome and observed tokens shows whether the
 * guidance earns its context cost, rather than assuming more instructions help.
 */
export type Arm = "guided" | "bare";
export interface ArmTask { arm: Arm; repository: string; pr: number; feature: string; merged: boolean; tokens: number | null }
export interface ArmSummary {
  arm: Arm; repository: string; tasks: number; merged: number; successRate: number;
  measured: number; tokens: number; tokensPerMerge: number | null;
}
export interface Comparison { guided: ArmSummary; bare: ArmSummary; verdict: string; caveats: string[] }

/** Task PRs of one sandbox: PRs into a Crewbie feature branch, optionally one plan's branch only. */
export async function armTasks(client: GitHubApi, repository: string, arm: Arm, feature?: string): Promise<ArmTask[]> {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Sandbox repository must be owner/name.");
  const tasks: ArmTask[] = [];
  for (const pull of await client.list(`/repos/${repository}/pulls?state=all`)) {
    const base = string(record(pull.base, "PR base").ref, "PR base ref");
    if (!base.startsWith("crewbie/") || (feature !== undefined && base !== feature)) continue;
    tasks.push({
      arm, repository, pr: integer(pull.number, "PR number"), feature: base,
      merged: typeof pull.merged_at === "string" && pull.merged_at.length > 0,
      tokens: attributedTokens(typeof pull.body === "string" ? pull.body : ""),
    });
  }
  return tasks;
}

function summarize(arm: Arm, repository: string, tasks: ArmTask[]): ArmSummary {
  const merged = tasks.filter((task) => task.merged).length;
  const measured = tasks.filter((task) => task.tokens !== null);
  const tokens = measured.reduce((sum, task) => sum + task.tokens!, 0);
  const measuredMerges = measured.filter((task) => task.merged).length;
  return {
    arm, repository, tasks: tasks.length, merged, successRate: tasks.length ? merged / tasks.length : 0,
    measured: measured.length, tokens,
    // Only comparable when every task has measured usage; a partial total would flatter the arm with gaps.
    tokensPerMerge: measured.length === tasks.length && measuredMerges ? Math.round(tokens / measuredMerges) : null,
  };
}

export function compareArms(guidedRepository: string, bareRepository: string, tasks: ArmTask[]): Comparison {
  const guided = summarize("guided", guidedRepository, tasks.filter((task) => task.arm === "guided"));
  const bare = summarize("bare", bareRepository, tasks.filter((task) => task.arm === "bare"));
  const caveats: string[] = [];
  if (guided.tasks !== bare.tasks) caveats.push(`The arms ran different task counts (${guided.tasks} vs ${bare.tasks}); check both sandboxes ran the same plan.`);
  if (Math.min(guided.tasks, bare.tasks) < 5) caveats.push("Fewer than five tasks per arm; treat the result as anecdotal and repeat with more features.");
  for (const arm of [guided, bare]) if (arm.measured < arm.tasks) caveats.push(`${arm.arm} arm: ${arm.tasks - arm.measured} of ${arm.tasks} PRs have no measured tokens, so token cost is not compared.`);
  caveats.push("Model sampling varies between runs; one comparison does not prove a cause.");
  let verdict: string;
  if (!guided.tasks || !bare.tasks) verdict = "Not comparable: an arm has no task PRs yet.";
  else {
    const delta = Math.round((guided.successRate - bare.successRate) * 100);
    const success = delta > 0 ? `Guidance merged ${delta} percentage points more tasks` : delta < 0 ? `Guidance merged ${-delta} percentage points fewer tasks` : "Both arms merged the same share of tasks";
    const cost = guided.tokensPerMerge === null || bare.tokensPerMerge === null ? "token cost per merged task is unavailable"
      : `at ${guided.tokensPerMerge} vs ${bare.tokensPerMerge} observed tokens per merged task (${guided.tokensPerMerge > bare.tokensPerMerge ? "+" : ""}${Math.round((guided.tokensPerMerge / bare.tokensPerMerge - 1) * 100)}%)`;
    verdict = `${success}, ${cost}.${delta <= 0 && guided.tokensPerMerge !== null && bare.tokensPerMerge !== null && guided.tokensPerMerge > bare.tokensPerMerge ? " The guidance costs context without improving outcomes here; review what it adds." : ""}`;
  }
  return { guided, bare, verdict, caveats };
}

export function renderComparison(comparison: Comparison): string {
  const row = (arm: ArmSummary) => `| ${arm.arm} | \`${arm.repository}\` | ${arm.merged}/${arm.tasks} (${Math.round(arm.successRate * 100)}%) | ${arm.measured}/${arm.tasks} | ${arm.tokens} | ${arm.tokensPerMerge ?? "unavailable"} |`;
  return [
    "| Arm | Sandbox | Merged | Measured | Observed tokens | Tokens per merged task |",
    "| --- | --- | --- | --- | --- | --- |",
    row(comparison.guided), row(comparison.bare), "",
    comparison.verdict, "",
    ...comparison.caveats.map((caveat) => `- ${caveat}`),
    "- Observed tokens come from Crewbie's PR attribution (main-session logs), not an invoice.",
  ].join("\n");
}
