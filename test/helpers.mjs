import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

export const config = (overrides = {}) => ({
  schemaVersion: 1, repository: "example/project",
  roles: [{ id: "developer", purpose: "Implement focused changes and verify existing behavior.", model: "approved-model" }],
  constitution: null, maxActive: 2,
  nightly: { enabled: false, maxRecords: 20, allowedPaths: [".crewbie/team/", ".crewbie/decisions/", ".crewbie/decisions.md"] },
  ado: null, ...overrides,
});
export const task = (id, dependsOn = []) => ({
  id, title: `Implement ${id}`, body: `Make ${id} work.\n\n## Acceptance criteria\n- Existing behavior remains covered by relevant tests.`,
  owner: "developer", model: "approved-model", priority: 1, dependsOn,
});
export const batch = () => ({
  schemaVersion: 1, id: "feature", spec: "Solve a small user problem without changing unrelated behavior.",
  sources: [{ uri: "requirements.md", revision: "source-v1" }],
  tasks: [task("foundation"), task("consumer", ["foundation"]), task("independent")], approval: null,
});
export async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "crewbie-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}
export function work(id, { dependencies = [], state = "ready", claimed = false, approved = true, priority = 1 } = {}) {
  return {
    issue: { number: id.charCodeAt(0), labels: [] },
    metadata: { batch: "feature", batchDigest: "same-batch", branch: "crewbie/feature", task: { ...task(id, dependencies), priority } },
    state, claimed, approved, reason: "fixture",
  };
}
export const run = (overrides = {}) => ({
  id: "example/project#1", specialist: "developer", requestedModel: "approved-model",
  observedModel: null, observedModelSource: null, date: "2026-09-22T07:00:00Z",
  status: "review", issue: "https://github.com/example/project/issues/1", pullRequest: null,
  inputTokens: null, outputTokens: null, credits: null, currencyAmount: null, currency: null,
  usageSource: null, summary: "Reviewer requested a focused regression test.", ...overrides,
});
