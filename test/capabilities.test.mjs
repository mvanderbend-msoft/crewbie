import test from "node:test";
import assert from "node:assert/strict";
import { probeCapabilities, renderReport } from "../dist/execution/capabilities.js";
import { agentName, githubReader, GitHubError, repositoryName } from "../dist/execution/github.js";

function reader({ enabled = true, profile = true, type = "Organization" } = {}) {
  return {
    async get(path) {
      if (path.includes("/contents/")) {
        if (!profile) throw new GitHubError(404, null);
        return { type: "file", sha: "profile-revision" };
      }
      return { owner: { type }, default_branch: "main", archived: false };
    },
    async query() {
      return { repository: { suggestedActors: { nodes: enabled ? [{ login: "copilot-swe-agent" }] : [] } } };
    },
  };
}

test("discovery reports enabled capabilities without claiming live proof or model validation", async () => {
  const report = await probeCapabilities(reader(), { repository: "example/project", agent: "crewbie-test", model: "chosen-model" });
  assert.equal(report.liveAssignmentVerified, false);
  assert.equal(report.findings.find((f) => f.id === "cloud-agent").status, "ready");
  assert.equal(report.findings.find((f) => f.id === "requested-model").status, "unknown");
  assert.equal(report.findings.find((f) => f.id === "usage-telemetry").status, "unknown");
  assert.match(renderReport(report), /Read-only check/);
});

test("unavailable cloud agent and missing specialist are blockers, never generic fallbacks", async () => {
  const report = await probeCapabilities(reader({ enabled: false, profile: false }), { repository: "example/project", agent: "crewbie-test" });
  assert.deepEqual(report.findings.filter((f) => f.status === "blocked").map((f) => f.id), ["cloud-agent", "agent-profile"]);
});

test("missing specialist remains explicitly unknown", async () => {
  const report = await probeCapabilities(reader(), { repository: "example/project" });
  assert.equal(report.findings.find((f) => f.id === "agent-profile").status, "unknown");
});

test("personal repositories do not claim organization nightly authentication", async () => {
  const report = await probeCapabilities(reader({ type: "User" }), { repository: "example/project" });
  assert.match(report.findings.find((f) => f.id === "nightly-auth").detail, /Personal repositories/);
});

test("malformed responses are errors, not success-shaped defaults", async () => {
  const broken = reader();
  broken.query = async () => ({ repository: { suggestedActors: { nodes: null } } });
  await assert.rejects(probeCapabilities(broken, { repository: "example/project" }), /invalid suggested-actor/);
});

test("profile authorization failures other than not-found are surfaced", async () => {
  const denied = reader();
  const original = denied.get;
  denied.get = async (path) => {
    if (path.includes("/contents/")) throw new GitHubError(403, "request-1");
    return original(path);
  };
  await assert.rejects(probeCapabilities(denied, { repository: "example/project", agent: "crewbie-test" }), /GitHub HTTP 403/);
});

test("repository and profile names cannot escape their API paths", () => {
  for (const value of ["https://github.com/a/b", "a/../b", "a/b?ref=secret", "a/.."]) {
    assert.throws(() => repositoryName(value));
  }
  for (const value of ["../foo", "name.agent.md", ""]) assert.throws(() => agentName(value));
  assert.equal(repositoryName("an-org/a_repo.git").fullName, "an-org/a_repo.git");
});

test("client uses only documented read requests and refuses redirects", async () => {
  const requests = [];
  const client = githubReader("test-token", async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(url.endsWith("/graphql") ? { data: { repository: {} } } : { ok: true }));
  });
  await client.get("/repos/example/project");
  await client.query("query { viewer { login } }", {});
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  await assert.rejects(client.get("//another-host.example"), /API-relative/);
});

test("GitHub errors never print the response body or credential", async () => {
  const client = githubReader("test-secret", async () =>
    new Response("untrusted response with sensitive information", { status: 401 }));
  await assert.rejects(client.get("/repos/example/project"), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /test-secret|sensitive information/);
    return true;
  });
});

test("GraphQL partial failure is not silently accepted", async () => {
  const client = githubReader("test-token", async () =>
    new Response(JSON.stringify({ data: { repository: {} }, errors: [{ message: "denied" }] })));
  await assert.rejects(client.query("query { viewer { login } }", {}), /could not complete/);
});
