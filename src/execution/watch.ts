import { setTimeout } from "node:timers/promises";
import { integer } from "../core.js";
import { requireApproval, type Batch } from "../specification/batch.js";
import { batchWork, type Work } from "./dispatch.js";

export interface WatchResult {
  outcome: "handoff" | "blocked" | "timeout";
  rounds: number;
  work: Work[];
}

export async function watchBatch(
  batch: Batch,
  reconcile: () => Promise<Work[]>,
  options: { pollMs?: number; timeoutMs?: number; progress?: (work: Work[]) => void } = {},
): Promise<WatchResult> {
  requireApproval(batch);
  if (!batch.approval?.execute) throw new Error("Watching requires execution approval.");
  const pollMs = integer(options.pollMs ?? 30_000, "poll interval", 1, 300_000);
  const deadline = Date.now() + integer(options.timeoutMs ?? 3_600_000, "watch timeout", 1, 86_400_000);
  let rounds = 0;
  let previous = "";
  while (true) {
    const work = batchWork(await reconcile(), batch);
    rounds++;
    const fingerprint = JSON.stringify(work.map((item) => [item.issue.number, item.state, item.reason]));
    if (fingerprint !== previous) options.progress?.(work);
    previous = fingerprint;
    if (work.every((item) => item.state === "done" || (item.state === "review" && item.sessionComplete))) {
      return { outcome: "handoff", rounds, work };
    }
    if (work.some((item) => item.state === "failed") || !work.some((item) => ["running", "ready"].includes(item.state))) {
      return { outcome: "blocked", rounds, work };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { outcome: "timeout", rounds, work };
    await setTimeout(Math.min(pollMs, remaining));
    if (Date.now() >= deadline) return { outcome: "timeout", rounds, work };
  }
}
