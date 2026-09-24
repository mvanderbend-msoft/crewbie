import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { terminalPrompts } from "../dist/setup/terminal.js";

const choices = [
  { value: "team", name: "Team", description: "Install the team only." },
  { value: "all", name: "All", description: "Install team and guidance." },
  { value: "save", name: "Save", description: "Keep the proposal without installation." },
];

function terminal(t) {
  const input = new PassThrough(), output = new PassThrough();
  let screen = "";
  output.on("data", (chunk) => { screen += chunk.toString(); });
  t.after(() => { input.destroy(); output.destroy(); });
  return { input, screen: () => screen, prompts: terminalPrompts({ input, output }) };
}

test("real terminal selector handles arrow keys and Enter, with Save selected initially", async (t) => {
  const io = terminal(t);
  const result = io.prompts.select("Install this proposal?", choices, "save");
  await setImmediate();
  assert.match(io.screen(), /Team[\s\S]*All[\s\S]*Save/);
  assert.match(io.screen(), /Keep the proposal without installation/);
  io.input.write("\x1b[A");
  io.input.write("\r");
  assert.equal(await result, "all");
});

test("real terminal selector defaults to Save and propagates Ctrl+C cancellation", async (t) => {
  const saved = terminal(t);
  const saving = saved.prompts.select("Install?", choices, "save");
  await setImmediate();
  saved.input.write("\r");
  assert.equal(await saving, "save");
  const cancelled = terminal(t);
  const cancelling = assert.rejects(cancelled.prompts.select("Install?", choices, "save"), { name: "ExitPromptError" });
  await setImmediate();
  cancelled.input.write("\x03");
  await cancelling;
});
