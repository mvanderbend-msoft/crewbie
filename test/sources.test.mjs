import test from "node:test";
import assert from "node:assert/strict";
import { verifySources } from "../dist/tracking/sources.js";
import { hash } from "../dist/core.js";
import { config } from "./helpers.mjs";

test("GitHub content fingerprints ignore bookkeeping but detect changed requirements", async () => {
  const issue = { title: "Title", body: "Behavior", updated_at: "later" };
  const client = { request: async () => issue };
  const source = { uri: "https://github.com/example/project/issues/42", revision: "old", fingerprint: hash("Title\n\nBehavior") };
  await verifySources([source], client, config());
  issue.body = "Different scope";
  await assert.rejects(verifySources([source], client, config()), /Source changed/);
});

test("ADO material drift requires reapproval; comment-only revisions do not", async () => {
  const fields = { "System.Title": "Requirement", "System.Description": "Behavior" };
  const ado = { request: async () => ({ rev: 8, fields }) };
  const cfg = config({ ado: { organization: "org", project: "Project", workItemType: "Task" } });
  const source = { uri: "https://dev.azure.com/org/Project/_workitems/edit/1", revision: "7", fingerprint: hash("Requirement\n\nBehavior") };
  await verifySources([source], {}, cfg, ado);
  fields["System.Description"] = "New behavior";
  await assert.rejects(verifySources([source], {}, cfg, ado), /requirements changed/);
});
