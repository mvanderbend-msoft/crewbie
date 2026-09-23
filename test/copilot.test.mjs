import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, realpath, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { CopilotClient } from "@github/copilot-sdk";
import { copilotAccess } from "../dist/setup/copilot.js";
import { fixture } from "./helpers.mjs";

function environment(t, key, value) {
  const before = process.env[key];
  process.env[key] = value;
  t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
}

function runtime(overrides = {}) {
  return {
    start: async () => {}, stop: async () => [], forceStop: async () => {},
    listModels: async () => [],
    createSession: async () => ({
      sendAndWait: async () => ({ data: { content: '{"summary":"complete"}' } }),
      disconnect: async () => {},
    }),
    ...overrides,
  };
}

test("assessment sends the explicit prompt/model with no tools and isolated configuration", async (t) => {
  environment(t, "COPILOT_PROVIDER_BASE_URL", "http://must-not-use.invalid");
  environment(t, "COPILOT_CUSTOM_INSTRUCTIONS_DIRS", "must-not-load");
  let options, disconnected = false, stopped = false;
  const adapter = copilotAccess((config) => {
    options = config;
    assert.equal(config.mode, "empty");
    assert.equal(config.connection.kind, "stdio");
    assert.equal(config.gitHubToken, "fixture-only");
    assert.equal(config.useLoggedInUser, false);
    assert.equal(config.env.COPILOT_PROVIDER_BASE_URL, undefined);
    assert.equal(config.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS, undefined);
    assert.equal(config.env.COPILOT_ALLOW_ALL, "false");
    assert.equal(dirname(config.baseDirectory), config.workingDirectory);
    assert.equal(basename(config.baseDirectory), "config");
    return runtime({
      stop: async () => { stopped = true; return []; },
      createSession: async (session) => {
        assert.equal(session.model, "chosen-model");
        assert.deepEqual(session.availableTools, []);
        assert.deepEqual(session.mcpServers, {});
        for (const key of ["enableConfigDiscovery", "enableSkills", "enableFileHooks", "enableOnDemandInstructionDiscovery", "enableHostGitOperations", "enableSessionStore"]) assert.equal(session[key], false);
        assert.equal(session.onPermissionRequest({ kind: "shell" }).kind, "reject");
        return {
          sendAndWait: async (request, timeout) => {
            assert.equal(request.prompt, 'Prompt with "quotes", & shell characters and\nnewlines');
            assert.equal(timeout, 300_000);
            return { data: { content: '{"summary":"complete"}' } };
          },
          disconnect: async () => { disconnected = true; },
        };
      },
    });
  }, () => "fixture-only");
  assert.equal(await adapter.analyze('Prompt with "quotes", & shell characters and\nnewlines', "chosen-model"), '{"summary":"complete"}');
  assert.ok(disconnected && stopped);
  await assert.rejects(access(options.workingDirectory), /ENOENT/);
});

test("model catalogue excludes auto and policy-disabled models and preserves billing metadata", async () => {
  const adapter = copilotAccess(() => runtime({
    listModels: async () => [
      { id: "auto", name: "Automatic" },
      { id: "disabled", name: "Disabled", policy: { state: "disabled" } },
      { id: "unconfigured", name: "Unconfigured", policy: { state: "unconfigured" } },
      { id: "enabled", name: "Enabled", policy: { state: "enabled" }, billing: { multiplier: 2 } },
      { id: "available", name: "Available" },
    ],
  }), () => "fixture-only");
  assert.deepEqual(await adapter.listModels(), [{ id: "enabled", name: "Enabled", multiplier: 2 }, { id: "available", name: "Available" }]);
  await assert.rejects(copilotAccess(() => runtime(), () => "fixture-only").listModels(), /No enabled models/);
});

test("empty responses, session errors and timeouts fail explicitly and clean up", async () => {
  for (const sendAndWait of [
    async () => undefined,
    async () => ({ data: { content: "   " } }),
    async () => { throw new Error("Session error: model unavailable"); },
    async () => { throw new Error("Timeout waiting for session idle"); },
  ]) {
    let directory, disconnected = false, stopped = false;
    const adapter = copilotAccess((options) => {
      directory = options.workingDirectory;
      return runtime({
        stop: async () => { stopped = true; return []; },
        createSession: async () => ({ sendAndWait, disconnect: async () => { disconnected = true; } }),
      });
    }, () => "fixture-only");
    await assert.rejects(adapter.analyze("Test", "chosen-model"), /no assessment|model unavailable|Timeout/);
    assert.ok(disconnected && stopped);
    await assert.rejects(access(directory), /ENOENT/);
  }
});

test("startup and cleanup failures remain explicit and never disclose the credential", async () => {
  let directory, forced = false;
  const adapter = copilotAccess((options) => {
    directory = options.workingDirectory;
    return runtime({
      start: async () => { throw new Error("Authentication failed for fixture-secret"); },
      stop: async () => [new Error("Shutdown failed")],
      forceStop: async () => { forced = true; },
    });
  }, () => "fixture-secret");
  await assert.rejects(adapter.listModels(), (error) => {
    assert.match(error.message, /Authentication failed.*REDACTED/);
    assert.match(error.message, /cleanup failed.*Shutdown failed/);
    assert.doesNotMatch(error.message, /fixture-secret/);
    return true;
  });
  assert.ok(forced);
  await assert.rejects(access(directory), /ENOENT/);
});

test("bundled SDK runtime handles a complete local provider response through stdio", { timeout: 60_000 }, async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "temp-real"));
  const alias = join(root, "temp-alias");
  await symlink(join(root, "temp-real"), alias, process.platform === "win32" ? "junction" : "dir");
  for (const key of ["TEMP", "TMP", "TMPDIR"]) environment(t, key, alias);
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ path: request.url, body: parsed });
    if (!parsed.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "gpt-4.1",
        choices: [{ index: 0, message: { role: "assistant", content: '{"summary":"complete"}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "gpt-4.1", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    response.end(chunk({ role: "assistant", content: '{"summary":' }) + chunk({ content: '"complete"}' }) + chunk({}, "stop") + "data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  let directory;
  const adapter = copilotAccess((options) => {
    directory = options.workingDirectory;
    const client = new CopilotClient({ ...options, gitHubToken: undefined });
    const createSession = client.createSession.bind(client);
    client.createSession = (config) => createSession({
      ...config,
      provider: { type: "openai", wireApi: "completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "fixture-only" },
    });
    return client;
  }, () => "fixture-only");
  assert.equal(await adapter.analyze('Return JSON for synthetic test: "quotes" & newlines\nonly.', "gpt-4.1"), '{"summary":"complete"}');
  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.match(request.path, /chat\/completions/);
    assert.equal(request.body.model, "gpt-4.1");
    assert.equal(request.body.tools?.length ?? 0, 0);
    assert.match(JSON.stringify(request.body.messages), /synthetic test/);
  }
  assert.equal(await realpath(dirname(directory)), await realpath(alias));
  await assert.rejects(access(directory), /ENOENT/);
});
