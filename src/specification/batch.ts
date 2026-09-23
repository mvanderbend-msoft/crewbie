import { bounded, hash, integer, record, slug, string, strings } from "../core.js";
import { limitsFor, type Config } from "../config.js";

export interface Task {
  id: string; title: string; body: string; owner: string; model: string;
  priority: number; dependsOn: string[];
  kind?: "implementation" | "review";
  adoWorkItem?: number;
}
function taskKind(value: unknown): NonNullable<Task["kind"]> {
  if (value !== "implementation" && value !== "review") throw new Error("Task kind must be implementation or review.");
  return value;
}
export interface SourceReference { uri: string; revision: string; fingerprint?: string }
export function sourceReferences(value: unknown): SourceReference[] {
  if (!Array.isArray(value)) throw new Error("sources must be a list of URI/revision records.");
  return value.map((item) => {
    const source = record(item, "source");
    return {
      uri: string(source.uri, "source URI"), revision: string(source.revision, "source revision"),
      ...(source.fingerprint === undefined ? {} : { fingerprint: string(source.fingerprint, "source fingerprint") }),
    };
  });
}
export interface Batch {
  schemaVersion: 1; id: string; spec: string;
  sources: SourceReference[];
  tasks: Task[];
  approval: { digest: string; execute: boolean } | null;
}
export function parseBatch(value: unknown, config?: Config): Batch {
  const data = record(value, "batch");
  if (data.schemaVersion !== 1) throw new Error("Unsupported batch version.");
  const spec = string(data.spec, "user-supplied scope or source reference");
  bounded(spec, limitsFor(config).spec, "User-supplied scope or source reference");
  const sources = sourceReferences(data.sources);
  if (!Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 100) throw new Error("A batch must contain 1-100 tasks.");
  const tasks = data.tasks.map((item): Task => {
    const task = record(item, "task");
    const result = {
      id: slug(task.id, "task ID"), title: string(task.title, "title"), body: string(task.body, "task body"),
      owner: slug(task.owner, "owner"), model: string(task.model, "model"),
      priority: integer(task.priority, "priority", 0, 1000), dependsOn: strings(task.dependsOn, "dependencies"),
      ...(task.kind === undefined ? {} : { kind: taskKind(task.kind) }),
      ...(task.adoWorkItem === undefined ? {} : { adoWorkItem: integer(task.adoWorkItem, "ADO work item") }),
    };
    bounded(result.body, limitsFor(config).spec, `${result.id} description`);
    if (result.model.trim().toLowerCase() === "auto") throw new Error("Tasks require an explicit approved model.");
    if (!/^#{1,3}\s+Acceptance criteria\s*$/im.test(result.body)) throw new Error(`${result.id} needs an Acceptance criteria heading.`);
    if (config && !config.roles.some((role) => role.id === result.owner && role.model === result.model)) throw new Error(`${result.id} owner/model does not match approved configuration.`);
    return result;
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Task IDs must be unique.");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const complete = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (complete.has(id)) return;
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}.`);
    const task = byId.get(id);
    if (!task) throw new Error(`Missing dependency: ${id}.`);
    visiting.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(id);
    complete.add(id);
  }
  for (const task of tasks) visit(task.id);
  const approval = data.approval == null ? null : record(data.approval, "approval");
  if (approval && typeof approval.execute !== "boolean") throw new Error("approval.execute must be boolean.");
  return {
    schemaVersion: 1, id: slug(data.id, "batch ID"), spec, sources, tasks,
    approval: approval ? { digest: string(approval.digest, "approval digest"), execute: approval.execute === true } : null,
  };
}
export function batchDigest(batch: Batch): string {
  return hash(JSON.stringify({ schemaVersion: batch.schemaVersion, id: batch.id, spec: batch.spec, sources: batch.sources, tasks: batch.tasks }));
}
export function approvedBatch(batch: Batch, execute: boolean): Batch {
  return { ...batch, approval: { digest: batchDigest(batch), execute } };
}
export function requireApproval(batch: Batch): void {
  if (batch.approval?.digest !== batchDigest(batch)) throw new Error("This batch is unapproved or changed after approval. Review and approve it again.");
}
export function issueDigest(title: string, body: string): string {
  return hash(JSON.stringify({ title, body }));
}
export function issueBody(batch: Batch, task: Task): string {
  const metadata = JSON.stringify({ batch: batch.id, batchDigest: batchDigest(batch), sources: batch.sources, task });
  if (task.body.includes("<!-- crewbie-task:")) throw new Error("Task body contains a reserved metadata marker.");
  return `${task.body}\n\n## Context\n\n${batch.spec}\n\n${batch.sources.map((source) => `- ${source.uri} (revision: ${source.revision})`).join("\n")}\n\nUse the named Crewbie specialist. Link the resulting PR to this issue. Read and report the specialist's charter and relevant memory. Keep the PR description concise.\n\n<!-- crewbie-task:${Buffer.from(metadata).toString("base64")} -->`;
}
export function taskMetadata(body: string): { batch: string; batchDigest: string; sources: SourceReference[]; task: Task } | null {
  const matches = [...body.matchAll(/<!-- crewbie-task:([A-Za-z0-9+/=]+) -->/g)];
  if (!matches.length) return null;
  if (matches.length !== 1 || !matches[0]?.[1]) throw new Error("Issue has ambiguous Crewbie metadata.");
  const value = record(JSON.parse(Buffer.from(matches[0][1], "base64").toString("utf8")) as unknown, "issue metadata");
  const task = record(value.task, "issue task");
  return {
    batch: slug(value.batch, "batch"), batchDigest: string(value.batchDigest, "batch digest"),
    sources: sourceReferences(value.sources),
    task: {
      id: slug(task.id, "task ID"), title: string(task.title, "title"), body: string(task.body, "body"),
      owner: slug(task.owner, "owner"), model: string(task.model, "model"),
      dependsOn: strings(task.dependsOn, "dependencies"), priority: integer(task.priority, "priority", 0, 1000),
      ...(task.kind === undefined ? {} : { kind: taskKind(task.kind) }),
      ...(task.adoWorkItem === undefined ? {} : { adoWorkItem: integer(task.adoWorkItem, "ADO work item") }),
    },
  };
}
