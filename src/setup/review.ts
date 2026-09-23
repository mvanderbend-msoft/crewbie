import { agentArchivePath, parseConfig } from "../config.js";
import { record, string } from "../core.js";
import type { FileChange } from "./install.js";

function cell(value: string): string { return value.replaceAll("|", "\\|").replace(/\r?\n/g, " "); }
function block(content: string): string {
  const length = Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1));
  const fence = "`".repeat(length);
  return `${fence}markdown\n${content}\n${fence}`;
}

export function setupReportPath(output: string): string {
  return /\.json$/i.test(output) ? output.replace(/\.json$/i, ".md") : `${output}.md`;
}

export function renderSetupMarkdown(value: unknown, changes?: FileChange[]): string {
  const data = record(value, "setup proposal");
  const config = parseConfig(data.config);
  const review = data.review === undefined ? undefined : record(data.review, "setup review");
  const installed = new Set(Array.isArray(data.installedRoles) ? data.installedRoles.map((role) => string(record(role, "installed role").id, "installed role id")) : []);
  const instructions = Array.isArray(data.instructions) ? data.instructions.map((raw) => record(raw, "guidance edit")) : [];
  const lines = [
    "# Crewbie assessment", "",
    review ? string(review.summary, "assessment summary") : "Reviewed setup proposal.", "",
    "## Proposed crew", "",
    "| Specialist | Action | Model | Responsibility |", "| --- | --- | --- | --- |",
    ...config.roles.map((role) => `| ${cell(role.id)} | ${installed.has(role.id) ? "Keep/update installed specialist" : role.sourceAgent ? `Adopt ${cell(role.sourceAgent)}` : "New specialist"} | ${cell(role.model)} | ${cell(role.purpose)} |`),
    "", `Concurrency: ${config.maxActive} active sessions. This is not a limit on team size.`, "",
  ];
  for (const role of config.roles) {
    lines.push(`### ${role.id}`, "");
    if (role.sourceAgent) lines.push(`Original: \`${role.sourceAgent}\` -> \`.github/agents/crewbie-${role.id}.agent.md\`.`,
      `Archive: \`${agentArchivePath(role.sourceAgent)}\`. Original domain guidance remains mandatory and original tool restrictions are preserved.`, "");
    if (role.checks?.length) lines.push("**Checks**", ...role.checks.map((check) => `- ${check}`), "");
    if (role.nonNegotiables?.length) lines.push("**Boundaries**", ...role.nonNegotiables.map((rule) => `- ${rule}`), "");
  }
  if (review && Array.isArray(review.agentDecisions) && review.agentDecisions.length) {
    lines.push("## Existing agent decisions", "");
    for (const raw of review.agentDecisions) {
      const decision = record(raw, "agent decision");
      lines.push(`- **${string(decision.action, "agent action")} \`${string(decision.path, "agent path")}\`**: ${string(decision.reason, "agent reason")}`);
    }
    lines.push("");
  }
  lines.push("## Proposed guidance edits", "",
    instructions.length ? `${instructions.length} concrete edits. These are applied only when guidance changes are approved.`
      : "**No existing guidance edits proposed.** Recommendations below are advisory; choosing to apply guidance does not turn recommendations into file edits.", "");
  for (const instruction of instructions) lines.push(`### ${string(instruction.path, "guidance path")}`, "",
    typeof instruction.reason === "string" ? instruction.reason : "Reviewed replacement text.", "",
    block(string(instruction.content, "guidance content")), "");
  if (typeof data.constitutionText === "string") lines.push("### Proposed constitution", "", block(data.constitutionText), "");
  lines.push("## Hosted planning", "", config.planning?.enabled
    ? `Enabled with model \`${config.planning.model}\`. The ready-for-planning label authorizes a potentially billable planning run; implementation still requires separate approval.`
    : "**Disabled.** The ready-for-planning label will not create a plan. Dispatch only handles published, approved implementation tasks.", "");
  if (review && Array.isArray(review.findings)) {
    lines.push("## Assessment findings and recommendations", "", "Recommendations are not automatically applied. Only the concrete guidance edits above are proposed writes.", "");
    for (const raw of review.findings) {
      const finding = record(raw, "assessment finding");
      lines.push(`### ${string(finding.area, "finding area")}${typeof finding.path === "string" ? ` - ${finding.path}` : ""}`, "",
        string(finding.assessment, "finding assessment"), "", `**Recommendation:** ${string(finding.recommendation, "finding recommendation")}`, "");
    }
  }
  if (data.inventory !== undefined) {
    const inventory = record(data.inventory, "inventory");
    lines.push("## Coverage", "", string(inventory.scope, "inventory scope"), "");
    if (Array.isArray(inventory.omitted)) for (const raw of inventory.omitted) {
      const item = record(raw, "omitted file");
      lines.push(`- \`${string(item.path, "omitted path")}\`: ${string(item.reason, "omission reason")}`);
    }
  }
  if (Array.isArray(data.questions) && data.questions.length) lines.push("", "## Open questions", "", ...data.questions.map((question) => `- ${string(question, "question")}`));
  if (changes) lines.push("", "## Reviewed installation files", "", ...changes.map((change) => `- ${change.after === null ? "Archive/remove original" : change.before === null ? "Create" : "Update"} \`${change.path}\``));
  return lines.join("\n") + "\n";
}

export function renderInstallationPreview(changes: FileChange[], labels: readonly string[], repository: string): string {
  return [
    `Installation preview: ${changes.filter((change) => change.before === null).length} files to create, ${changes.filter((change) => change.before !== null && change.after !== null).length} to update, ${changes.filter((change) => change.after === null).length} originals to archive/remove.`,
    ...changes.map((change) => `${change.after === null ? "Archive/remove" : change.before === null ? "Create" : "Update"} ${change.path}`),
    labels.length ? `Ensure ${labels.length} workflow and specialist labels in ${repository || "(repository not set)"}:\n${labels.join(", ")}` : "GitHub labels skipped.",
    "Preview only. Review the Markdown assessment and setup JSON before applying.",
  ].join("\n");
}
