import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listFiles, render, SCENARIOS } from "../examples/generate.mjs";
import { approvedBatch, parseBatch, requireApproval } from "../dist/specification/batch.js";

const examples = new URL("../examples/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const text = (value) => value.replace(/\r\n/g, "\n");

for (const name of SCENARIOS) {
  test(`example ${name} matches what Crewbie generates`, async () => {
    const { output, warnings, config } = await render(name);
    assert.deepEqual(warnings, []);
    for (const [path, content] of output) {
      assert.equal(text(await readFile(join(examples, name, path), "utf8")), text(content), `${name}/${path} is stale; run npm run examples`);
    }
    const committed = (await listFiles(join(examples, name, "repo"))).map((path) => `repo/${path}`);
    assert.deepEqual(committed.filter((path) => !output.has(path)), [], `${name} has files the generator no longer writes`);
    const batch = parseBatch(JSON.parse(await readFile(join(examples, name, "plan.json"), "utf8")), config);
    assert.equal(batch.approval, null);
    requireApproval(approvedBatch(batch, true));
  });
}
