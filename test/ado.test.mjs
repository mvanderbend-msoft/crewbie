import test from "node:test";
import assert from "node:assert/strict";
import { adoApi, createWorkItem, importWorkItem, writeBack } from "../dist/tracking/ado.js";
import { batch } from "./helpers.mjs";

const config = { organization: "org", project: "My Project", workItemType: "Product Backlog Item" };
test("ADO imports preserve revision and source instead of mutating requirements", async () => {
  const calls = [];
  const client = { async request(method, path) { calls.push(method); return { rev: 7, fields: { "System.Title": "Requirement", "System.Description": "<p>Text</p>" } }; } };
  const source = await importWorkItem(client, config, 123);
  assert.equal(source.revision, "7");
  assert.match(source.uri, /My%20Project/);
  assert.deepEqual(calls, ["GET"]);
});

test("ADO creation uses JSON Patch and a stable retry marker", async () => {
  const calls = [];
  const client = { async request(method, path, body, patch) {
    calls.push({ method, path, body, patch });
    return path === "/wiql" ? { workItems: [] } : { id: 123 };
  } };
  const b = batch();
  assert.equal(await createWorkItem(client, config, b, b.tasks[0]), 123);
  assert.equal(calls[1].patch, true);
  assert.ok(calls[1].body.some((entry) => entry.path === "/fields/System.Tags"));
  assert.ok(!calls[1].body.some((entry) => entry.path === "/fields/System.State"));
});

test("ADO write-back deduplicates comments, never changes state", async () => {
  const comments = [], calls = [];
  const client = { async request(method, path, body) {
    calls.push({ method, path, body });
    if (method === "GET") return { comments };
    comments.push({ text: body.text });
    return {};
  } };
  const links = ["https://github.com/example/project/issues/1"];
  assert.equal(await writeBack(client, 123, links, "Ready for review."), true);
  assert.equal(await writeBack(client, 123, links, "Ready for review."), false);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(calls.every((call) => call.path.includes("/comments")));
});

test("ADO transport selects the comments preview version and refuses redirects", async () => {
  const calls = [];
  const client = adoApi(config, "secret", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ comments: [] }));
  });
  await client.request("GET", "/workitems/1/comments");
  assert.match(calls[0].url, /api-version=7\.1-preview\.4/);
  assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(client.request("GET", "//untrusted"), /Invalid ADO resource/);
});
