import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, MEMORY, render, scenario, SCENARIOS } from "../examples/generate.mjs";
import { parseBatch } from "../dist/specification/batch.js";
import { planName } from "../dist/specification/planning.js";
import { parseConfig } from "../dist/config.js";
import { memoryContext, memoryLimit } from "../dist/memory/context.js";
import { visibleWords, withoutComments } from "../dist/core.js";

const examples = fileURLToPath(new URL("../examples/", import.meta.url));
const text = (value) => value.replace(/\r\n/g, "\n");
const read = async (path) => text(await readFile(path, "utf8"));
const optional = (path) => read(path).catch(() => null);

for (const name of SCENARIOS) {
  const project = join(examples, name, "project");

  test(`example ${name}: Crewbie-owned files match what Crewbie generates`, async () => {
    const example = await scenario(name);
    const { output, deleted, warnings } = await render(name);
    assert.deepEqual(warnings, []);
    for (const [path, content] of output) {
      assert.equal(await optional(join(examples, name, path)), text(content), `${name}/${path} is stale; run npm run examples`);
    }
    for (const path of deleted) assert.equal(await optional(join(project, path)), null, `${path} was removed by init`);
    const installed = new Set((await render(name)).changes.map((change) => change.path));
    for (const [path, reason] of Object.entries(example.evolved)) {
      assert.ok(installed.has(path), `${path} is listed as evolved but init does not write it`);
      assert.ok(reason.trim(), `${path} needs a reason`);
      assert.ok(await optional(join(project, path)), `${path} is evolved but missing from the project`);
    }
  });

  test(`example ${name}: plans match the team and the history`, async () => {
    const example = await scenario(name);
    const config = parseConfig(JSON.parse(await read(join(project, ".crewbie/config.json"))));
    const history = await read(join(examples, name, "HISTORY.md"));
    const plans = (await listFiles(join(project, ".crewbie/plans"))).filter((path) => path.endsWith("/batch.json"));
    assert.deepEqual(plans.sort(), example.issues.map((issue) => `${planName(issue.title, issue.number)}/batch.json`).sort());
    for (const issue of example.issues) {
      parseBatch(JSON.parse(await read(join(project, `.crewbie/plans/${planName(issue.title, issue.number)}/batch.json`))), config);
      assert.match(history, new RegExp(`#${issue.number}\\b`), `HISTORY.md does not mention issue #${issue.number}`);
    }
  });

  test(`example ${name}: memory is within budget, sourced and linked`, async () => {
    const config = parseConfig(JSON.parse(await read(join(project, ".crewbie/config.json"))));
    const history = await read(join(examples, name, "HISTORY.md"));
    for (const role of ["coordinator", "improver", ...config.roles.map((item) => item.id)]) await memoryContext(project, config, role);
    const memory = (await listFiles(join(project, ".crewbie"))).map((path) => `.crewbie/${path}`).filter((path) => MEMORY.test(path));
    for (const path of memory) {
      const content = await read(join(project, path));
      const limit = memoryLimit(config, path);
      if (limit !== null) assert.ok(visibleWords(withoutComments(content)) <= limit, `${path} exceeds ${limit} words`);
      if (path.endsWith("/hot.md")) {
        for (const line of content.split("\n").filter((item) => /^- /.test(item))) {
          const source = /<!-- source: #(\d+) (\d{4}-\d{2}-\d{2}) -->\s*$/.exec(line);
          assert.ok(source, `${path}: entry has no source comment: ${line}`);
          assert.match(history, new RegExp(`#${source[1]}\\b`), `${path}: source #${source[1]} is not in HISTORY.md`);
        }
      }
      if (path.endsWith("/index.md")) {
        const dir = path.slice(0, -"index.md".length);
        for (const [, target] of content.matchAll(/\]\(([^)\s]+)\)/g)) {
          if (/^(?:[a-z]+:|#)/i.test(target)) continue;
          assert.ok(await optional(join(project, dir, target)), `${path} links to missing ${target}`);
        }
      }
    }
  });
}
