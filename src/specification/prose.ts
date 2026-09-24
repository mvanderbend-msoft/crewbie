import { bounded } from "../core.js";

export function checkPrDescription(body: string, limit?: number): void {
  const telemetry = /<!-- crewbie-attribution -->[\s\S]*?<!-- \/crewbie-attribution -->/g;
  const blocks = [...body.matchAll(telemetry)];
  if (blocks.length > 1) throw new Error("PR has duplicate Crewbie telemetry blocks.");
  if (blocks[0]) bounded(blocks[0][0], 100, "PR telemetry");
  const prose = body.replace(telemetry, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (limit !== undefined) bounded(prose, limit, "PR description");
  const requirements = [
    { name: "What changed", pattern: /^#{1,3}\s+(?:what changed|summary)\s*$/im },
    { name: "Why", pattern: /^#{1,3}\s+(?:why|motivation|rationale)\s*$/im },
    { name: "Checks", pattern: /^#{1,3}\s+(?:checks|tests|validation|test plan)\s*$/im },
  ];
  for (const requirement of requirements) {
    const match = requirement.pattern.exec(prose);
    if (!match) throw new Error(`PR needs a short "${requirement.name}" section.`);
    const section = prose.slice(match.index + match[0].length).split(/^#{1,3}\s+/m)[0]?.trim();
    if (!section) throw new Error(`PR "${requirement.name}" section is empty.`);
  }
}
