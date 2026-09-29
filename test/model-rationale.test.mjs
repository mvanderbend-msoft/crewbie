import test from "node:test";
import assert from "node:assert/strict";
import { renderSetupReview } from "../dist/setup/onboarding.js";
import { config } from "./helpers.mjs";

function proposal(overrides = {}) {
  return {
    status: "ready",
    review: { summary: "Review the native app team.", findings: [] },
    config: config({ roles: [{ id: "ios-client", purpose: "Own native rendering and state management.", model: "selected-model" }] }),
    installedRoles: [],
    questions: [],
    instructions: [],
    inventory: { omitted: [] },
    constitutionText: null,
    ...overrides,
  };
}

test("terminal review shows the model profile, complexity and selection rationale before approval", () => {
  const value = proposal({ config: config({ modelProfile: "quality", roles: [{
    id: "ios-client", purpose: "Own native rendering and state management.", model: "selected-model",
    complexity: "complex", modelReason: "Rendering and state invariants justify stronger reasoning; review the additional cost.",
  }] }) });
  const before = structuredClone(value);
  const output = renderSetupReview(value);
  assert.match(output, /Model profile: quality/);
  assert.match(output, /Installed models and explicit overrides remain authoritative/);
  assert.match(output, /Capability judgments are proposals for human review, not benchmark facts/);
  assert.match(output, /Specialist ios-client \| selected-model/);
  assert.match(output, /Model proposal \(complex\): Rendering and state invariants justify stronger reasoning; review the additional cost\./);
  assert.deepEqual(value, before, "Displaying the rationale must not reassign models or alter the proposal.");
});

test("terminal review defaults to balanced without inventing rationale or complexity for explicit selections", () => {
  const output = renderSetupReview(proposal());
  assert.match(output, /Model profile: balanced/);
  assert.match(output, /Model proposal \(unclassified\): No rationale recorded; fixed or explicit selections may not include one\./);
  assert.doesNotMatch(output, /Model proposal \((?:routine|standard|complex)\)/);
});

test("terminal review distinguishes preserved installed rationale from a new model proposal", () => {
  const roles = [{
    id: "ios-client", purpose: "Own native rendering.", model: "installed-model",
    complexity: "complex", modelReason: "Previously approved for native rendering.",
  }, { id: "verifier", purpose: "Verify native behavior.", model: "another-installed-model" }];
  const value = proposal({ config: config({ roles }), installedRoles: structuredClone(roles) });
  const output = renderSetupReview(value);
  assert.match(output, /Keep\/update ios-client \| installed-model/);
  assert.match(output, /Recorded model rationale \(complex\): Previously approved for native rendering\./);
  assert.match(output, /Keep\/update verifier \| another-installed-model/);
  assert.match(output, /Recorded model rationale \(unclassified\): No rationale recorded; installed model retained\./);
  assert.doesNotMatch(output, /Model proposal \(/);
});

test("terminal review keeps adoption provenance alongside the model explanation", () => {
  const output = renderSetupReview(proposal({ config: config({ modelProfile: "economy", roles: [{
    id: "ios-client", purpose: "Own native rendering.", model: "selected-model",
    sourceAgent: ".github/agents/ios.agent.md", complexity: "standard", modelReason: "Balance known native checks and reported cost.",
  }] }) }));
  assert.match(output, /Model profile: economy/);
  assert.match(output, /Adopt ios-client \| selected-model/);
  assert.match(output, /Source: \.github\/agents\/ios\.agent\.md \(full instructions retained\)/);
  assert.match(output, /Model proposal \(standard\): Balance known native checks and reported cost\./);
});

test("terminal review does not invent role recommendations while clarification is needed", () => {
  const output = renderSetupReview(proposal({ status: "clarification", config: config({ roles: [] }), questions: ["Which native behavior needs support?"] }));
  assert.match(output, /Needs clarification: Which native behavior needs support\?/);
  assert.doesNotMatch(output, /Model proposal \(|Recorded model rationale \(/);
});
