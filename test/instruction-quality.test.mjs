import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assess } from "../dist/setup/assessment.js";
import { fixture } from "./helpers.mjs";

test("assessment flags concrete instruction risks with line evidence, without rewriting or executing", async (t) => {
  const repeated = "The system provides a product catalogue for warehouse operators and stores supplier records alongside inventory and customer order history.";
  const guide = `# Agent instructions\n\n${repeated}\n\nRun \`npm run missing-check\`.\nRead [the old guide](docs/removed.md).\nAlways run the entire test suite for every change.\n`;
  const root = await fixture(t, {
    "AGENTS.md": guide, "README.md": `# Application\n\n${repeated}\n`,
    "package.json": JSON.stringify({ scripts: { test: "THIS MUST NOT EXECUTE" } }),
  });
  const before = await readdir(root);
  const result = await assess(root), quality = result.instructionQuality;
  assert.deepEqual(quality.signals.map((s) => s.code).sort(), ["blind-reference", "duplicated-documentation", "missing-npm-script", "unconditional-full-suite", "unverified-reference"].sort());
  assert.equal(quality.signals.find((s) => s.code === "missing-npm-script").line, 5);
  assert.equal(quality.signals.find((s) => s.code === "unverified-reference").line, 6);
  assert.equal(quality.signals.find((s) => s.code === "duplicated-documentation").related, "README.md");
  assert.ok(quality.signals.every((s) => s.path === "AGENTS.md" && s.recommendation));
  assert.match(quality.interpretation, /not a quality score/);
  assert.equal(quality.basis, "https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd; https://arxiv.org/abs/2606.15828");
  assert.equal(result.findings.find((f) => f.area === "Instructions").status, "unknown");
  assert.equal(result.findings.find((f) => f.area === "Instruction quality").status, "gap");
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), guide);
  assert.deepEqual(await readdir(root), before);
  assert.deepEqual(result.instructions, []);
});

test("scoped concrete guidance, necessary standalone context and explicit gates are not penalized", async (t) => {
  const root = await fixture(t, {
    "AGENTS.md": "# Work\n\nUse integer cents; snapshot order prices before committing stock changes.\nRead [domain rules](docs/domain.md), [docs folder](docs/), or [root](./).\nBefore merge, always run the full test suite required by compliance.\n",
    "docs/domain.md": "A repository-specific rule.",
    "frontend/AGENTS.md": "Run `npm run check-ui` from this directory.\nDo not run npm run obsolete-check.\n",
    "frontend/package.json": JSON.stringify({ scripts: { "check-ui": "not executed" } }),
    "backend/package.json": JSON.stringify({ scripts: { "server-only": "not executed" } }),
  });
  const result = await assess(root);
  assert.deepEqual(result.instructionQuality.signals, []);
  assert.equal(result.findings.find((f) => f.area === "Instruction quality").status, "unknown", "No warnings is not certification.");
  assert.deepEqual(result.instructionQuality.inspected, ["AGENTS.md", "frontend/AGENTS.md"]);
});

test("generic-only agent charters are advisory, not a claim of measured harm", async (t) => {
  const root = await fixture(t, { ".github/agents/developer.agent.md": "---\r\nname: Developer\r\ndescription: Implements changes\r\n---\r\nYou are a senior software engineer.\r\nWrite high-quality code and tests.\r\nBe thorough.\r\n" });
  const result = await assess(root);
  assert.equal(result.instructionQuality.signals[0].code, "generic-only");
  assert.equal(result.instructionQuality.signals[0].level, "advisory");
  assert.equal(result.instructionQuality.signals[0].line, 5);
  assert.match(result.instructionQuality.interpretation, /not a harmful length threshold/);
});

test("npm guidance without a scoped package manifest is reported", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Run `npm run lint` then `npm run test`.\n" });
  const quality = (await assess(root)).instructionQuality;
  assert.deepEqual(quality.signals.map((signal) => signal.code), ["missing-package-manifest"]);
  assert.equal(quality.signals[0].line, 1);
});

test("always-loaded guidance over 200 lines is context bloat, and limits disclose coverage", async (t) => {
  const long = "# Context\n\n" + Array.from({ length: 250 }, (_, i) => `Constraint ${i}: preserve version ${i} compatibility at boundary ${i}.`).join("\n");
  const root = await fixture(t, { "AGENTS.md": long, "nested/CLAUDE.md": "x".repeat(65_000) });
  const result = await assess(root);
  assert.deepEqual(result.instructionQuality.signals.map((signal) => [signal.code, signal.level]), [["context-bloat", "warning"]]);
  assert.deepEqual(result.instructionQuality.inspected, ["AGENTS.md"]);
  assert.equal(result.instructionQuality.omitted[0].path, "nested/CLAUDE.md");
  assert.match(result.instructionQuality.omitted[0].reason, /size alone is not a quality finding/);
  assert.ok(!result.findings.some((f) => f.area === "Guidance size"));
});

test("ignored instructions, external links, placeholders and incomplete manifest evidence are not guessed", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "private/\n",
    "private/AGENTS.md": "Write clean code.",
    "AGENTS.md": "Run `npm run example`.\nRun `npm run optional --if-present`.\nRead [web](https://example.invalid/docs), [section](#x), [placeholder](${ROOT}/guide.md).\n",
    "package.json": "{ not valid JSON",
  });
  const result = await assess(root);
  assert.deepEqual(result.instructionQuality.inspected, ["AGENTS.md"]);
  assert.deepEqual(result.instructionQuality.signals, []);
  assert.match(result.instructionQuality.omitted[0].reason, /Invalid package JSON/);
});

test("monorepo script checks respect instruction scope and conditional skills remain data", async (t) => {
  const root = await fixture(t, {
    "frontend/AGENTS.md": "Run `npm run server-only`.\n",
    "frontend/package.json": JSON.stringify({ scripts: { build: "not executed" } }),
    "backend/package.json": JSON.stringify({ scripts: { "server-only": "not executed" } }),
    ".github/agents/ui.agent.md": "---\nname: UI\n---\n# UI\nPreserve focus when async data changes.\n",
  });
  const result = await assess(root);
  assert.equal(result.instructionQuality.signals.length, 1);
  assert.equal(result.instructionQuality.signals[0].code, "missing-npm-script");
  assert.ok(result.instructionQuality.inspected.includes(".github/agents/ui.agent.md"));
});

test("repeated specialist boilerplate is distinguished from role-specific expertise", async (t) => {
  const repeated = "Work only on the approved task and preserve existing behavior across all affected callers while reporting material risks and actual verification outcomes.";
  const root = await fixture(t, {
    ".github/agents/frontend.agent.md": `# Frontend\n\n${repeated}\n\nCheck keyboard focus after asynchronous rendering.`,
    ".github/agents/backend.agent.md": `# Backend\n\n${repeated}\n\nCheck transaction rollback and optimistic concurrency.`,
  });
  const quality = (await assess(root)).instructionQuality;
  assert.equal(quality.signals.length, 2);
  assert.ok(quality.signals.every((signal) => signal.code === "shared-profile-boilerplate" && signal.level === "advisory"));
  assert.match(quality.signals[0].detail, /not proven runtime harm/);
});

test("large warning sets stay readable and disclose unshown signals", async (t) => {
  const root = await fixture(t, { "AGENTS.md": Array.from({ length: 20 }, (_, i) => `Read [guide ${i}](missing-${i}.md) before editing module ${i}.`).join("\n") });
  const result = await assess(root);
  assert.equal(result.instructionQuality.signals.length, 12);
  assert.equal(result.instructionQuality.signalsOmitted, 8);
  assert.match(result.findings.find((finding) => finding.area === "Instruction quality").detail, /20 advisory signals detected; showing 12/);
});

test("a noisy root instruction file cannot hide findings in other guidance files", async (t) => {
  const root = await fixture(t, {
    "AGENTS.md": Array.from({ length: 20 }, (_, i) => `Read [guide ${i}](missing-${i}.md) before editing module ${i}.`).join("\n"),
    "frontend/AGENTS.md": "Follow best practices.",
    ".github/instructions/backend.instructions.md": "Preserve database boundaries.",
  });
  const quality = (await assess(root)).instructionQuality;
  assert.ok(quality.signals.some((signal) => signal.path === "frontend/AGENTS.md" && signal.code === "generic-only"));
  assert.ok(quality.signals.some((signal) => signal.path === ".github/instructions/backend.instructions.md" && signal.code === "missing-path-scope"));
});

test("configuration smells: lint leakage, blind references and init fossilization", async (t) => {
  const guide = "# Rules\n\nUse 2-space indentation and single quotes.\nNever store money as floats; use integer cents.\n- [docs/arch.md](docs/arch.md)\nRead [architecture](docs/arch.md) before changing module boundaries.\n";
  const root = await fixture(t, { "AGENTS.md": guide, "docs/arch.md": "Boundaries.", ".prettierrc": "{}" });
  const quality = (await assess(root)).instructionQuality;
  const lint = quality.signals.filter((signal) => signal.code === "lint-leakage");
  assert.deepEqual(lint.map((signal) => [signal.line, signal.level, signal.related]), [[3, "warning", ".prettierrc"]]);
  assert.deepEqual(quality.signals.filter((signal) => signal.code === "blind-reference").map((signal) => signal.line), [5], "An explained reference is fine.");
  assert.ok(!quality.signals.some((signal) => signal.code === "init-fossilization"), "Untracked files have no history.");

  const bare = await fixture(t, { "AGENTS.md": "Use camelCase for variables.\n" });
  assert.equal((await assess(bare)).instructionQuality.signals.find((signal) => signal.code === "lint-leakage").level, "advisory", "Without a configured tool it is a suggestion.");

  const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
  git("add", "AGENTS.md"); git("commit", "-q", "-m", "init guidance");
  for (let i = 0; i < 10; i++) git("commit", "-q", "--allow-empty", "-m", `work ${i}`);
  const fossil = (await assess(root)).instructionQuality.signals.find((signal) => signal.code === "init-fossilization");
  assert.match(fossil.detail, /Committed once .* 10 commits since/);
  await writeFile(join(root, "AGENTS.md"), `${guide}Updated.\n`);
  git("commit", "-q", "-am", "refresh guidance");
  assert.ok(!(await assess(root)).instructionQuality.signals.some((signal) => signal.code === "init-fossilization"), "An updated file is not fossilized.");
});
