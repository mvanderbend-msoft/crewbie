import { agentName, GitHubError, object, repositoryName, text, type GitHubReader } from "./github.js";

export type CapabilityStatus = "ready" | "blocked" | "unknown";

export interface Finding {
  id: string;
  status: CapabilityStatus;
  detail: string;
}

export interface CapabilityReport {
  schemaVersion: 1;
  repository: string;
  accountType: string;
  baseBranch: string;
  findings: Finding[];
  liveAssignmentVerified: false;
}

export interface ProbeOptions {
  repository: string;
  agent?: string;
  model?: string;
}

const ACTORS_QUERY = `query CrewbieCapabilities($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 100) {
      nodes { login }
    }
  }
}`;

export async function probeCapabilities(reader: GitHubReader, options: ProbeOptions): Promise<CapabilityReport> {
  const repo = repositoryName(options.repository);
  const selectedAgent = options.agent === undefined ? undefined : agentName(options.agent);
  if (options.model !== undefined && !options.model.trim()) {
    throw new Error("A requested model must be a non-empty model identifier.");
  }
  const prefix = `/repos/${repo.fullName}`;
  const metadata = object(await reader.get(prefix), "repository");
  const owner = object(metadata.owner, "repository owner");
  const accountType = text(owner.type, "repository owner type");
  const baseBranch = text(metadata.default_branch, "default branch");
  const findings: Finding[] = [{
    id: "repository-access",
    status: "ready",
    detail: `Repository metadata is accessible. The default branch is ${baseBranch}.`,
  }];
  if (metadata.archived === true || metadata.disabled === true) {
    findings.push({ id: "repository-state", status: "blocked", detail: "This repository is archived or disabled." });
  }

  const data = object(await reader.query(ACTORS_QUERY, { owner: repo.owner, name: repo.name }), "actor query");
  const actors = object(object(data.repository, "actor repository").suggestedActors, "suggested actors");
  if (!Array.isArray(actors.nodes)) throw new Error("GitHub returned an invalid suggested-actor list.");
  const enabled = actors.nodes.some((node: unknown) => object(node, "suggested actor").login === "copilot-swe-agent");
  findings.push({
    id: "cloud-agent",
    status: enabled ? "ready" : "blocked",
    detail: enabled
      ? "GitHub advertises Copilot as assignable for this credential and repository; no session was started."
      : "GitHub did not advertise Copilot as assignable. Check account entitlement and repository policy.",
  });

  if (selectedAgent) {
    const path = `${prefix}/contents/.github/agents/${selectedAgent}.agent.md?ref=${encodeURIComponent(baseBranch)}`;
    try {
      const file = object(await reader.get(path), "agent profile");
      if (file.type !== "file") throw new Error("The selected agent profile is not a regular file.");
      text(file.sha, "agent profile revision");
      findings.push({
        id: "agent-profile",
        status: "ready",
        detail: `${selectedAgent}.agent.md exists on ${baseBranch}. Runtime selection and memory loading still need a live proof.`,
      });
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
      findings.push({
        id: "agent-profile",
        status: "blocked",
        detail: `The selected profile was not found on ${baseBranch}, or this credential cannot read it.`,
      });
    }
  } else {
    findings.push({ id: "agent-profile", status: "unknown", detail: "Choose a specialist profile with --agent before testing execution." });
  }

  findings.push(
    {
      id: "requested-model",
      status: "unknown",
      detail: options.model
        ? `Requested model: ${options.model}. Read-only discovery cannot prove assignment accepts it or that the runtime uses it.`
        : "No model was selected. Crewbie must obtain an explicit approved model before launch.",
    },
    {
      id: "nightly-auth",
      status: "unknown",
      detail: accountType === "Organization"
        ? "Check organization Copilot CLI billing policy and copilot-requests: write in a consenting Actions run."
        : "Personal repositories can use GITHUB_TOKEN with copilot-requests: write, billed to the owner's Copilot seat. Verify entitlement in a consenting Actions run.",
    },
    {
      id: "private-dashboard",
      status: "unknown",
      detail: "Private Pages entitlement is not established. Use a repository-access-controlled Actions artifact until verified.",
    },
    {
      id: "usage-telemetry",
      status: "unknown",
      detail: "Exact per-specialist cloud tokens, billed spend, and observed model are not guaranteed by a documented public interface.",
    },
    {
      id: "live-assignment",
      status: "unknown",
      detail: "User-authorized live issue assignment, PR linkage, selected profile/model, and memory-read evidence remain unverified.",
    },
  );
  return { schemaVersion: 1, repository: repo.fullName, accountType, baseBranch, findings, liveAssignmentVerified: false };
}

export function renderReport(report: CapabilityReport): string {
  return [
    `Crewbie capability check: ${report.repository}`,
    ...report.findings.map((finding) => `[${finding.status}] ${finding.id}: ${finding.detail}`),
    "",
    "Read-only check. No issue, session, pull request, workflow, or repository file was changed.",
  ].join("\n");
}
