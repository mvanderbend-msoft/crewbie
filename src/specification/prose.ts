import { bounded } from "../core.js";

export function checkPrDescription(body: string, limit?: number): void {
  const telemetry = /<!-- crewbie-attribution -->[\s\S]*?<!-- \/crewbie-attribution -->/g;
  const blocks = [...body.matchAll(telemetry)];
  if (blocks.length > 1) throw new Error("PR has duplicate Crewbie telemetry blocks.");
  if (blocks[0]) bounded(blocks[0][0], 100, "PR telemetry");
  const prose = body.replace(telemetry, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (limit !== undefined) bounded(prose, limit, "PR description");
  if (!prose) throw new Error("PR description is empty.");
}
