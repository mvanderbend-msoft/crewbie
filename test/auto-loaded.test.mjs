import test from "node:test";
import assert from "node:assert/strict";
import { autoLoadedGuidance, autoLoadedPointer, removeAutoLoadedPointers } from "../dist/setup/auto-loaded.js";
import { assessInstructions } from "../dist/setup/instruction-quality.js";
import { adoptedProfile } from "../dist/setup/agents.js";
import { profile } from "../dist/setup/templates.js";
import { setupPrompt } from "../dist/setup/onboarding.js";
import { parseConfig } from "../dist/config.js";
import { assess } from "../dist/setup/assessment.js";
import { fixture, config } from "./helpers.mjs";

test("only Copilot-attached guidance counts as automatically loaded", () => {
  for (const path of [".github/copilot-instructions.md", "AGENTS.md", "api/AGENTS.md", ".github/instructions/backend.instructions.md", ".github/instructions/a/b.instructions.md"])
    assert.equal(autoLoadedGuidance(path), true, path);
  for (const path of ["CLAUDE.md", "docs/backend.md", ".github/agents/backend.agent.md", ".github/instructions/notes.md"])
    assert.equal(autoLoadedGuidance(path), false, path);
});

test("pointer detection separates pointer-only lines, mixed lines, negations and code", () => {
  assert.deepEqual(autoLoadedPointer("1. Read `.github/copilot-instructions.md` and `.github/instructions/backend.instructions.md`."),
    { references: [".github/copilot-instructions.md", ".github/instructions/backend.instructions.md"], pointerOnly: true });
  assert.equal(autoLoadedPointer("- See [the repository rules](AGENTS.md) first.").pointerOnly, true);
  assert.equal(autoLoadedPointer("Read AGENTS.md, then verify order totals in src/order.ts.").pointerOnly, false);
  assert.equal(autoLoadedPointer("Do not read AGENTS.md again."), null);
  assert.equal(autoLoadedPointer("Follow the order rules."), null);
  const started = Date.now();
  assert.equal(autoLoadedPointer(`read ${"a".repeat(200_000)} AGENTS.md`).pointerOnly, false);
  assert.ok(Date.now() - started < 1000, "long lines stay linear");
  const cleaned = removeAutoLoadedPointers("# Process\n1. Read `AGENTS.md`.\n2. Check totals.\n```\nRead AGENTS.md\n```\n");
  assert.equal(cleaned.text, "# Process\n2. Check totals.\n```\nRead AGENTS.md\n```\n");
  assert.deepEqual(cleaned.removed, ["1. Read `AGENTS.md`."]);
});

test("assessment flags pointers to automatically loaded guidance and agent-only documents", async (t) => {
  const root = await fixture(t, {
    ".github/copilot-instructions.md": "Use UTC for order timestamps.",
    "docs/orders.md": "Orders are immutable after dispatch.",
    ".github/agents/backend.agent.md": "---\nname: backend\ndescription: Backend.\n---\n## Process\n\n1. Read `.github/copilot-instructions.md` and `.github/instructions/backend.instructions.md`.\n2. Read `docs/orders.md` before changing orders.\n",
    "CLAUDE.md": "Read `.github/copilot-instructions.md` first.",
  });
  const paths = [".github/copilot-instructions.md", "docs/orders.md", ".github/agents/backend.agent.md", "CLAUDE.md"];
  const { signals } = await assessInstructions(root, paths);
  const pointer = signals.find((signal) => signal.code === "auto-loaded-reference");
  assert.equal(pointer.path, ".github/agents/backend.agent.md");
  assert.equal(pointer.line, 7);
  assert.match(pointer.detail, /backend\.instructions\.md does not exist/);
  assert.match(pointer.recommendation, /Remove the line/);
  assert.ok(!signals.some((signal) => signal.code === "auto-loaded-reference" && signal.path === "CLAUDE.md"), "other hosts need their pointers");
  const only = signals.find((signal) => signal.code === "agent-only-context");
  assert.equal(only.related, "docs/orders.md");
});

test("adopted charters drop pointer-only lines and profiles omit automatically loaded context", () => {
  const cfg = parseConfig(config({ roles: [{ id: "backend", purpose: "Own the API.", model: "approved-model", sourceAgent: ".github/agents/backend.agent.md",
    contextPaths: ["AGENTS.md", ".github/instructions/api.instructions.md", "docs/api.md"] }] }));
  const role = cfg.roles[0];
  const result = adoptedProfile(role, cfg, "---\nname: backend\ndescription: Backend.\n---\n## Process\n\n1. Read `.github/copilot-instructions.md` and `.github/instructions/backend.instructions.md`.\n2. Keep handlers thin.\n");
  assert.doesNotMatch(result, /1\. Read/);
  assert.match(result, /2\. Keep handlers thin\./);
  assert.match(profile(role, cfg), /Reuse existing guidance: `docs\/api\.md`\./);
  assert.doesNotMatch(profile(role, cfg), /AGENTS\.md|api\.instructions\.md/);
});

test("the assessment prompt asks for pointer removal and needed scoped instruction files", async (t) => {
  const root = await fixture(t, { "AGENTS.md": "Use UTC." });
  const prompt = setupPrompt(await assess(root), "Pizza ordering.");
  assert.match(prompt, /auto-loaded-reference signal/);
  assert.match(prompt, /Create path-scoped instruction files when needed/);
});
