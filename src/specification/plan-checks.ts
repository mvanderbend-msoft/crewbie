import type { Batch, Task } from "./batch.js";
import { missingPaths, type RepositoryMap } from "../setup/repository-map.js";

/**
 * Deterministic checks of a proposed plan against its source issue and the working tree. They are advisory:
 * they surface under-specified contracts, overlapping paid runs and stale paths for the human reviewing the plan.
 */
const UNIT: Record<string, string> = {
  ms: "ms", millisecond: "ms", milliseconds: "ms",
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
  m: "min", min: "min", mins: "min", minute: "min", minutes: "min",
  h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
  d: "d", day: "d", days: "d",
  kb: "KB", mb: "MB", gb: "GB", "%": "%",
};
const QUANTITY = /(?<![\w.])(\d+(?:\.\d+)?)\s?(ms|milliseconds?|secs?|seconds?|s|mins?|minutes?|m|hrs?|hours?|h|days?|d|kb|mb|gb|%)(?![\w])/gi;
const STATUS = /\b(?:HTTP\s*|status\s*(?:code\s*)?(?:of\s*)?|returns?\s+(?:an?\s+)?|respond(?:s|ing)?\s+with\s+(?:an?\s+)?)([1-5]\d\d)\b|\b([1-5]\d\d)\s+(?:OK|Created|Accepted|No Content|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Gone|Unprocessable|Too Many Requests|Internal Server Error|Service Unavailable)\b/gi;

/** Concrete contract values: HTTP status codes and quantities with units, normalized for comparison. */
export function contractValues(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(STATUS)) values.add(`HTTP ${match[1] ?? match[2]}`);
  for (const match of text.matchAll(QUANTITY)) values.add(`${Number(match[1])}${UNIT[match[2]!.toLowerCase()] ?? match[2]}`);
  return [...values];
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "are", "is", "be", "to", "of", "in", "on", "a", "an", "or", "it", "its", "when", "each", "all", "any", "from", "into", "by", "as", "at", "not", "no", "must", "should", "can", "only", "via", "per"]);
function words(line: string): Set<string> {
  return new Set(line.toLowerCase().replace(/`[^`]*`/g, (span) => span.replace(/[^\w]+/g, "_")).split(/[^\w/.-]+/).filter((word) => word.length >= 3 && !STOP.has(word)));
}
function criteria(task: Task): string[] {
  const section = /^#{2,3}\s+Acceptance criteria\s*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im.exec(task.body)?.[1] ?? "";
  return section.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?/i, "").trim()).filter((line) => line.length > 0);
}
function jaccard(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared || 1);
}
const OVERLAP = 0.6;
const GENERIC = /^(?:existing behavio(?:u)?r remains covered by relevant tests|all (?:existing )?tests pass|no regressions?)\.?$/i;

export function planChecks(batch: Batch, source: string, map: RepositoryMap | null): string[] {
  const warnings: string[] = [];
  const issueValues = new Set(contractValues(source));
  const carried = new Set<string>();
  for (const task of batch.tasks) {
    const values = contractValues(`${task.title}\n${task.body}`);
    values.forEach((value) => carried.add(value));
    const invented = values.filter((value) => !issueValues.has(value));
    if (invented.length) warnings.push(`\`${task.id}\` states values the source issue does not: ${invented.join(", ")}. Confirm them, or ask instead of guessing.`);
    const missing = map ? missingPaths(map, `${task.title}\n${task.body}`) : [];
    if (missing.length) warnings.push(`\`${task.id}\` cites paths not in the repository: ${missing.slice(0, 8).map((path) => `\`${path}\``).join(", ")}. Fine if the task creates them; otherwise correct the plan.`);
  }
  const dropped = [...issueValues].filter((value) => !carried.has(value));
  if (dropped.length) warnings.push(`The source issue states values no task carries: ${dropped.join(", ")}. Put them verbatim in the task that owns that behavior.`);
  const work = batch.tasks.filter((task) => task.kind !== "review");
  for (let i = 0; i < work.length; i++) for (let j = i + 1; j < work.length; j++) {
    const shared = criteria(work[i]!).filter((line) => !GENERIC.test(line))
      .find((line) => criteria(work[j]!).some((other) => !GENERIC.test(other) && jaccard(words(line), words(other)) >= OVERLAP));
    if (shared) warnings.push(`\`${work[i]!.id}\` and \`${work[j]!.id}\` share an acceptance criterion ("${shared.slice(0, 120)}"). Give each deliverable, including its tests, one owning task so two paid runs do not build it.`);
  }
  return warnings;
}

const SHOWN = 12;
export function renderPlanChecks(warnings: string[]): string {
  if (!warnings.length) return "";
  const more = warnings.length > SHOWN ? `\n- ${warnings.length - SHOWN} more warnings not shown.` : "";
  return `## Plan checks\n\nCrewbie compared the tasks with the source issue and the repository file names. Advisory; nothing was changed.\n\n${warnings.slice(0, SHOWN).map((warning) => `- ${warning.slice(0, 400)}`).join("\n")}${more}\n\n`;
}
