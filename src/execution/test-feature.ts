import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitHubError, integer, json, record, string, writeAtomic } from "../core.js";
import type { Config } from "../config.js";
import { parseConfig } from "../config.js";
import { FEATURE_MARKER } from "./dispatch.js";
import { managedIssues } from "../tracking/issues.js";
import { taskMetadata } from "../specification/batch.js";
import type { GitHubApi } from "../tracking/github.js";

const exec = promisify(execFile);
const RECENTLY_CLOSED_MS = 7 * 24 * 60 * 60 * 1000;

export interface TestFeature {
  branch: string;
  batch: string;
  title: string;
  status: "ready for testing" | "in progress";
  sourceIssues: number[];
  sourceTitle?: string;
  pullRequest?: { number: number; url: string; title: string };
  tasks?: { done: number; total: number };
}

function labelsOf(issue: Record<string, unknown>): string[] {
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels.map((label) => typeof label === "string" ? label : String(record(label, "label").name));
}

function sameRepoIssue(config: Config, uri: string): number | null {
  const prefix = `https://github.com/${config.repository}/issues/`;
  return uri.startsWith(prefix) && /^\d+$/.test(uri.slice(prefix.length)) ? Number(uri.slice(prefix.length)) : null;
}

function taskIssueNumbers(body: string): Set<number> {
  return new Set([...body.matchAll(/^- #(\d+)(?!\d)/gm)].map((match) => Number(match[1])));
}

function prdIssuesFromPr(body: string, title: string): number[] {
  const tasks = taskIssueNumbers(body);
  const closes = [...body.matchAll(/^Closes #(\d+)(?!\d)/gim)].map((match) => Number(match[1])).filter((number) => !tasks.has(number));
  const titled = /\(#(\d+)\)\s*$/.exec(title)?.[1];
  return [...new Set([...closes, ...(titled ? [Number(titled)] : [])])].sort((a, b) => a - b);
}

async function sourceTitle(client: GitHubApi, config: Config, issue: number): Promise<string | undefined> {
  try {
    const source = record(await client.request("GET", `/repos/${config.repository}/issues/${integer(issue, "source issue")}`), "source issue");
    return string(source.title, "source title");
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return undefined;
    throw error;
  }
}

async function branchExists(client: GitHubApi, config: Config, branch: string): Promise<boolean> {
  try {
    await client.request("GET", `/repos/${config.repository}/git/ref/heads/${branch}`);
    return true;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false;
    throw error;
  }
}

export async function discoverTestFeatures(client: GitHubApi, config: Config, now = new Date()): Promise<TestFeature[]> {
  if (!config.repository) throw new Error("Configure repository before testing a feature.");
  const byBranch = new Map<string, TestFeature>();
  const openPulls = await client.list(`/repos/${config.repository}/pulls?state=open`);
  for (const raw of openPulls) {
    const body = typeof raw.body === "string" ? raw.body : "";
    if (!body.includes(FEATURE_MARKER)) continue;
    const head = record(raw.head, "feature PR head");
    const branch = string(head.ref, "feature branch");
    const title = string(raw.title, "feature PR title");
    const sourceIssues = prdIssuesFromPr(body, title);
    const source = sourceIssues[0];
    const sourceName = source === undefined ? undefined : await sourceTitle(client, config, source);
    byBranch.set(branch, {
      branch,
      batch: /<!-- crewbie-feature:([a-z][a-z0-9-]{0,63}) -->/.exec(body)?.[1] ?? branch,
      title,
      status: "ready for testing",
      sourceIssues,
      ...(sourceName === undefined ? {} : { sourceTitle: sourceName }),
      pullRequest: {
        number: integer(raw.number, "feature PR number"),
        url: string(raw.html_url, "feature PR URL"),
        title,
      },
    });
  }
  const issues = [
    ...await managedIssues(client, config.repository, "open"),
    ...await managedIssues(client, config.repository, "closed", new Date(now.getTime() - RECENTLY_CLOSED_MS)),
  ];
  const groups = new Map<string, { batch: string; sourceIssues: Set<number>; title?: string; done: number; total: number }>();
  for (const issue of issues) {
    const metadata = taskMetadata(String(issue.body ?? ""));
    if (!metadata) continue;
    const labels = labelsOf(issue);
    const group = groups.get(metadata.branch) ?? { batch: metadata.batch, sourceIssues: new Set<number>(), done: 0, total: 0 };
    group.total += 1;
    if (labels.includes("crewbie:done")) group.done += 1;
    for (const source of metadata.sources) {
      const number = sameRepoIssue(config, source.uri);
      if (number !== null) group.sourceIssues.add(number);
    }
    groups.set(metadata.branch, group);
  }
  for (const [branch, group] of groups) {
    if (byBranch.has(branch)) {
      const existing = byBranch.get(branch)!;
      existing.tasks = { done: group.done, total: group.total };
      existing.sourceIssues = [...new Set([...existing.sourceIssues, ...group.sourceIssues])].sort((a, b) => a - b);
      continue;
    }
    if (!await branchExists(client, config, branch)) continue;
    const sourceIssues = [...group.sourceIssues].sort((a, b) => a - b);
    const source = sourceIssues[0];
    const title = source === undefined ? `Crewbie feature: ${group.batch}` : await sourceTitle(client, config, source) ?? `Issue #${source}`;
    byBranch.set(branch, {
      branch,
      batch: group.batch,
      title,
      status: "in progress",
      sourceIssues,
      ...(source === undefined ? {} : { sourceTitle: title }),
      tasks: { done: group.done, total: group.total },
    });
  }
  return [...byBranch.values()].sort((a, b) =>
    Number(a.status !== "ready for testing") - Number(b.status !== "ready for testing")
    || a.title.localeCompare(b.title) || a.branch.localeCompare(b.branch));
}

function searchable(feature: TestFeature): string {
  return [feature.title, feature.sourceTitle, feature.batch, feature.branch, feature.status].filter(Boolean).join(" ").toLowerCase();
}

export function matchingTestFeatures(features: TestFeature[], query: string): TestFeature[] {
  const value = query.trim().toLowerCase();
  if (!value) return features;
  const numeric = /^#?(\d+)$/.exec(value)?.[1];
  if (numeric) {
    const number = Number(numeric);
    return features.filter((feature) => feature.sourceIssues.includes(number) || feature.pullRequest?.number === number);
  }
  return features.filter((feature) => feature.branch.toLowerCase() === value
    || value.split(/\s+/).every((word) => searchable(feature).includes(word)));
}

export function renderTestFeatureList(features: TestFeature[]): string {
  if (!features.length) return "No Crewbie feature branches or feature PRs were found.";
  return features.map((feature) => {
    const source = feature.sourceIssues.length ? ` #${feature.sourceIssues.join(", #")}` : "";
    const tasks = feature.tasks && feature.status === "in progress" ? ` (${feature.tasks.done}/${feature.tasks.total} tasks merged)` : "";
    const pr = feature.pullRequest ? ` PR #${feature.pullRequest.number}` : "";
    return `${feature.status}${tasks}: ${source ? `${source} ` : ""}${feature.title} [${feature.branch}]${pr}`;
  }).join("\n");
}

export async function suggestedStartCommand(root: string): Promise<string | null> {
  let manifest: { scripts?: Record<string, unknown> };
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
  } catch {
    return null;
  }
  const scripts = manifest.scripts ?? {};
  const exists = async (path: string) => access(join(root, path)).then(() => true, () => false);
  const runner = await exists("pnpm-lock.yaml") ? "pnpm" : await exists("yarn.lock") ? "yarn" : "npm";
  const run = (script: string) => runner === "npm" ? (script === "start" ? "npm start" : `npm run ${script}`)
    : runner === "pnpm" ? (script === "start" ? "pnpm start" : `pnpm run ${script}`)
      : script === "start" ? "yarn start" : `yarn ${script}`;
  if (typeof scripts.dev === "string") {
    const dev = run("dev");
    return typeof scripts["install:all"] === "string" ? `${run("install:all")} && ${dev}` : dev;
  }
  return typeof scripts.start === "string" ? run("start") : null;
}

async function git(root: string, args: string[], allowFailure = false): Promise<{ stdout: string; status: number; stderr: string }> {
  try {
    const result = await exec("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
    return { stdout: result.stdout, stderr: result.stderr, status: 0 };
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; code?: unknown };
    if (allowFailure) return {
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
      status: typeof failure.code === "number" ? failure.code : 1,
    };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
    throw new Error(stderr || `git ${args.join(" ")} failed.`);
  }
}

async function localBranchExists(root: string, branch: string): Promise<boolean> {
  return (await git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], true)).status === 0;
}

async function ancestor(root: string, older: string, newer: string): Promise<boolean> {
  return (await git(root, ["merge-base", "--is-ancestor", older, newer], true)).status === 0;
}

export async function checkoutTestFeature(root: string, feature: TestFeature): Promise<{ previous: string }> {
  if (!/^crewbie\/[a-z][a-z0-9-]{0,63}$/.test(feature.branch)) throw new Error(`Invalid Crewbie feature branch: ${feature.branch}`);
  const status = (await git(root, ["status", "--porcelain"])).stdout;
  if (status.trim()) throw new Error("Working tree has uncommitted changes. Commit, stash or move them before testing a Crewbie feature; Crewbie will not discard changes.");
  const previous = (await git(root, ["branch", "--show-current"])).stdout.trim() || (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  await git(root, ["fetch", "origin", feature.branch]);
  if (await localBranchExists(root, feature.branch)) {
    const remote = `origin/${feature.branch}`;
    if (!await ancestor(root, feature.branch, remote) && !await ancestor(root, remote, feature.branch)) {
      throw new Error(`Local ${feature.branch} has diverged from ${remote}. Reconcile it manually; no checkout was performed.`);
    }
    await git(root, ["switch", feature.branch]);
    await git(root, ["merge", "--ff-only", remote]);
  } else {
    await git(root, ["switch", "--track", "-c", feature.branch, `origin/${feature.branch}`]);
  }
  return { previous };
}

export function runStartCommand(root: string, command: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: root, shell: true, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) reject(new Error(`Start command stopped by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

export function selectionOrThrow(features: TestFeature[], query: string): TestFeature {
  const matches = matchingTestFeatures(features, query);
  if (matches.length === 1) return matches[0]!;
  const list = renderTestFeatureList(matches.length ? matches : features);
  throw new Error(matches.length ? `Several Crewbie features match "${query}":\n${list}` : `No Crewbie feature matches "${query}". Available features:\n${list}`);
}

export async function saveLocalStart(root: string, config: Config, command: string): Promise<Config> {
  const next = parseConfig({ ...config, local: { start: command } });
  await writeAtomic(root, ".crewbie/config.json", json(next));
  return next;
}
