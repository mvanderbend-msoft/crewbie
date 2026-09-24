import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import stringWidth from "string-width";
import { createOutput, wrapText } from "../dist/presentation.js";
import { json } from "../dist/core.js";

function capture({ isTTY = true, columns = 80, env = {}, machine = false } = {}) {
  let stdout = "", stderr = "";
  const output = createOutput({
    stdout: { isTTY, columns, write: (text) => { stdout += text; } },
    stderr: { isTTY, columns, write: (text) => { stderr += text; } },
    env, machine,
  });
  return { output, stdout: () => stdout, stderr: () => stderr };
}

test("terminal status uses aligned tables with distinct ready, blocked and unknown colours", () => {
  const io = capture();
  io.output.heading("status");
  io.output.data([
    { issue: 12, task: "catalogue", state: "ready", reason: "Approved dependencies." },
    { issue: 13, task: "retry", state: "blocked", reason: "Human approval required." },
    { issue: 14, task: "model", state: "unknown", reason: "Runtime model unverified." },
  ]);
  assert.match(stripVTControlCharacters(io.stdout()), /CREWBIE \/ STATUS/);
  assert.match(io.stdout(), /ISSUE.*\|.*TASK.*\|.*STATE.*\|.*REASON/);
  assert.match(io.stdout(), /\x1b\[32mready/);
  assert.match(io.stdout(), /\x1b\[31mblocked/);
  assert.match(io.stdout(), /\x1b\[33munknown/);
  assert.ok(stripVTControlCharacters(io.stdout()).split("\n").every((line) => stringWidth(line) <= 80));
});

test("narrow terminals retain every field using cards instead of overflowing tables", () => {
  const io = capture({ columns: 32 });
  io.output.data([{ issue: 42, task: "a-long-task-with-no-spaces-at-all", state: "blocked", reason: "等待人工批准 🧑‍💻 Preserve the dependency contract." }]);
  const text = stripVTControlCharacters(io.stdout());
  assert.ok(text.split("\n").every((line) => stringWidth(line) <= 32));
  assert.match(text, /issue: 42/);
  assert.match(text, /state: blocked/);
  assert.ok(text.includes("🧑‍💻"));
  assert.match(text, /dependency\s+contract/);
});

test("wrapped tables also wrap long column headings without losing cell content", () => {
  const io = capture({ columns: 40 });
  io.output.data([{ unusuallyLongHeading: "a very long value with the final detail", state: "unknown" }]);
  const text = stripVTControlCharacters(io.stdout());
  assert.ok(text.split("\n").every((line) => stringWidth(line) <= 40));
  assert.match(text, /final detail/);
  assert.match(text, /unknown/);
});

test("explicit JSON and redirected data retain the exact machine-readable output", () => {
  const value = { approval: null, enabled: false, tasks: [{ id: "one", body: "First\nSecond" }], count: 0 };
  for (const options of [{ machine: true }, { isTTY: false, env: { FORCE_COLOR: "1" } }]) {
    const io = capture(options);
    io.output.heading("status");
    io.output.data(value);
    assert.equal(io.stdout(), json(value) + "\n");
    assert.deepEqual(JSON.parse(io.stdout()), value);
    assert.doesNotMatch(io.stdout(), /\x1b/);
  }
  const io = capture({ machine: true });
  io.output.data(value, "Readable fallback must not replace JSON.");
  assert.deepEqual(JSON.parse(io.stdout()), value);
});

test("NO_COLOR, FORCE_COLOR=0 and dumb terminals keep readable output without escapes", () => {
  for (const env of [{ NO_COLOR: "" }, { FORCE_COLOR: "0" }, { TERM: "dumb" }]) {
    const io = capture({ env });
    io.output.heading("doctor");
    io.output.text("[unknown] assignment was not verified.");
    io.output.error("Run doctor --repo owner/name.");
    assert.match(io.stdout(), /\[UNKNOWN\]/);
    assert.match(io.stderr(), /ERROR Crewbie/);
    assert.doesNotMatch(io.stdout() + io.stderr(), /\x1b/);
  }
});

test("plain fallback reports and error output retain pipeline behavior", () => {
  const io = capture({ isTTY: false });
  io.output.data({ ready: false }, "Read-only check: unknown.");
  io.output.error("doctor requires --repo owner/repository.");
  assert.equal(io.stdout(), "Read-only check: unknown.\n");
  assert.equal(io.stderr(), "Crewbie: doctor requires --repo owner/repository.\n");
});

test("formatting preserves nested details and strips terminal control sequences from displayed data", () => {
  const io = capture({ columns: 60 });
  io.output.data({ tasks: [{ body: "Acceptance criteria:\nKeep data intact.", dependsOn: ["prior"], approved: false }],
    omitted: [], detail: "\x1b[2JVisible detail." });
  const text = stripVTControlCharacters(io.stdout());
  assert.match(text, /Keep data intact/);
  assert.match(text, /prior/);
  assert.match(text, /approved: false/);
  assert.match(text, /\(none\)/);
  assert.match(text, /Visible detail/);
  assert.doesNotMatch(io.stdout(), /\x1b\[2J/);
});

test("Unicode wrapping counts terminal cells and retains complete graphemes", () => {
  const value = "  Long path: " + "界".repeat(30) + " 🧑‍💻 e\u0301 " + "x".repeat(80);
  const wrapped = wrapText(value, 24);
  assert.ok(wrapped.split("\n").every((line) => stringWidth(line) <= 24));
  assert.equal(wrapped.replace(/\s/g, ""), value.replace(/\s/g, ""));
});
