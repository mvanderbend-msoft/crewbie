import { readFile, stat } from "node:fs/promises";
import type { Role } from "../config.js";
import { safePath } from "../core.js";

export interface TeamAssessment {
  suggestions: { role: Role; evidence: string[]; reason: string }[];
  reviewExisting: { id: string; reason: string }[];
  coverage: { inspected: string[]; omitted: string[]; warnings: string[] };
}

const hints: Record<string, Omit<Role, "id" | "model">> = {
  frontend: {
    purpose: "Implement and test user interfaces using the repository's component and state conventions.",
    checks: ["Exercise loading, empty, failure and recovery states with keyboard and narrow-screen interaction."],
    nonNegotiables: ["Preserve accessible interactions and compatibility at the UI/API boundary."],
  },
  backend: {
    purpose: "Implement service contracts, domain behavior and persistence without breaking existing consumers.",
    checks: ["Cover input validation, compatibility, data integrity and failure recovery at service boundaries."],
    nonNegotiables: ["Preserve transaction boundaries and return explicit errors for rejected operations."],
  },
  infrastructure: {
    purpose: "Evolve infrastructure definitions and deployment boundaries using the repository's existing tooling.",
    checks: ["Review plans or diffs, least-privilege access, environment isolation and rollback paths."],
    nonNegotiables: ["Apply infrastructure only with explicit authorization; keep credentials outside tracked files."],
  },
  data: {
    purpose: "Evolve data transformations and pipelines while preserving their contracts and provenance.",
    checks: ["Check schema evolution, data quality, repeatable runs and partial-failure recovery."],
    nonNegotiables: ["Protect source data; require explicit approval for destructive migrations or backfills."],
  },
  mobile: {
    purpose: "Implement device-facing behavior within the repository's mobile framework and platform conventions.",
    checks: ["Cover lifecycle changes, offline recovery, permissions and platform accessibility."],
    nonNegotiables: ["Preserve user state and platform compatibility; request only necessary device permissions."],
  },
  ai: {
    purpose: "Implement model and agent integrations with explicit evaluation and tool boundaries.",
    checks: ["Evaluate representative inputs, failure modes, tool authorization and untrusted-content handling."],
    nonNegotiables: ["Keep model outputs untrusted; preserve explicit model choices and usage provenance."],
  },
  cli: {
    purpose: "Evolve command-line behavior, automation contracts and cross-platform installation.",
    checks: ["Cover argument validation, exit codes, machine-readable output and noninteractive execution."],
    nonNegotiables: ["Keep credentials out of arguments and output; preserve scripting compatibility."],
  },
  documentation: {
    purpose: "Maintain the repository's documentation product and executable examples.",
    checks: ["Check links, examples, navigation and documentation builds where available."],
    nonNegotiables: ["Keep examples accurate and distinguish verified behavior from proposed capabilities."],
  },
  developer: {
    purpose: "Make focused changes using the repository's existing conventions and relevant tests.",
  },
  tester: {
    purpose: "Design focused regression and boundary tests, preserve application behavior, and report actual outcomes and coverage gaps.",
  },
  reviewer: {
    purpose: "Review changes against acceptance criteria for correctness and material risks, with evidence rather than unrelated rewrites.",
  },
};

const packageSignals: Record<string, string[]> = {
  frontend: ["react", "react-dom", "next", "vue", "@angular/core", "svelte", "solid-js", "astro"],
  backend: ["express", "fastify", "@nestjs/core", "koa", "hono"],
  mobile: ["react-native", "expo"],
  ai: ["openai", "@anthropic-ai/sdk", "@openai/agents", "@langchain/core", "@langchain/langgraph"],
  documentation: ["vitepress", "@docusaurus/core"],
};

export async function assessTeam(root: string, paths: string[], current: Role[]): Promise<TeamAssessment> {
  const evidence = new Map<string, Set<string>>();
  const coverage: TeamAssessment["coverage"] = { inspected: [], omitted: [], warnings: [] };
  const add = (id: string, path: string) => {
    const found = evidence.get(id) ?? new Set<string>();
    found.add(path);
    evidence.set(id, found);
  };
  const candidates = paths.filter((path) =>
    !/(^|\/)(?:\.git|\.github|\.crewbie|\.crewbie-local|node_modules|vendor|dist|build|target|coverage|test|tests|__tests__|fixtures|__fixtures__|examples|samples)\//.test(path));
  for (const path of candidates) {
    if (/\.(?:test|spec)\.[^.]+$/.test(path)) continue;
    if (/\.(tsx|jsx|vue|svelte)$/.test(path)) add("frontend", path);
    if (/(^|\/)(api|server|backend)\/.*\.(ts|js|py|java|go|cs|rb|rs|kt|php)$/.test(path)) add("backend", path);
    if (/\.(tf|bicep)$|(^|\/)Pulumi\.ya?ml$/.test(path)) add("infrastructure", path);
    if (/(^|\/)dbt_project\.yml$|(^|\/)(pipelines|transforms)\/.*\.(py|sql)$/.test(path)) add("data", path);
    if (/(^|\/)AndroidManifest\.xml$|(^|\/)ios\/.*\.swift$/.test(path)) add("mobile", path);
    if (/(^|\/)(mkdocs\.ya?ml|docusaurus\.config\.[^.]+)$/.test(path)) add("documentation", path);
  }
  const manifests = candidates.filter((path) =>
    /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|pom\.xml|pubspec\.yaml)$|\.csproj$/.test(path))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  let bytes = 0;
  for (const path of manifests) {
    if (coverage.inspected.length >= 20) { coverage.omitted.push(path); continue; }
    const file = await safePath(root, path);
    const size = (await stat(file)).size;
    if (size > 64 * 1024 || bytes + size > 512 * 1024) {
      coverage.omitted.push(path);
      continue;
    }
    const content = await readFile(file, "utf8");
    bytes += Buffer.byteLength(content);
    coverage.inspected.push(path);
    if (path.endsWith("package.json")) {
      let manifest: unknown;
      try { manifest = JSON.parse(content) as unknown; } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        coverage.warnings.push(`${path}: invalid JSON; dependency hints were not inspected.`);
        continue;
      }
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        coverage.warnings.push(`${path}: expected a package object; dependency hints were not inspected.`);
        continue;
      }
      const dependencies = new Set<string>();
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const values: unknown = Reflect.get(manifest, field);
        if (values && typeof values === "object" && !Array.isArray(values)) {
          for (const name of Object.keys(values)) dependencies.add(name);
        }
      }
      for (const [id, names] of Object.entries(packageSignals)) {
        if (names.some((name) => dependencies.has(name))) add(id, path);
      }
      const bin: unknown = Reflect.get(manifest, "bin");
      if ((typeof bin === "string" && bin.trim()) || (bin && typeof bin === "object" && !Array.isArray(bin) && Object.keys(bin).length)) add("cli", path);
    } else {
      if (path.endsWith("pom.xml") && /<artifactId>\s*(?:spring-boot-starter-web(?:flux)?|quarkus-rest[^<]*|micronaut-http-server[^<]*)\s*<\/artifactId>/.test(content)) add("backend", path);
      if (path.endsWith(".csproj") && /Sdk\s*=\s*["']Microsoft\.NET\.Sdk\.Web["']/.test(content)) add("backend", path);
      if (path.endsWith("pubspec.yaml") && /^\s*flutter\s*:/m.test(content)) add("mobile", path);
      if (/(pyproject\.toml|requirements[^/]*\.txt)$/.test(path)) {
        if (/^\s*["']?(?:fastapi|flask|django)(?:["'<>=~;\s[])/m.test(content)) add("backend", path);
        if (/^\s*["']?(?:openai|anthropic|langchain|langgraph)(?:["'<>=~;\s[])/m.test(content)) add("ai", path);
      }
    }
  }
  // These are discovery hints, not a closed set of roles or permission to replace approved ones.
  if (!evidence.size && !current.length) evidence.set("developer", new Set());
  evidence.set("tester", new Set());
  evidence.set("reviewer", new Set());
  const suggestions = Object.entries(hints).filter(([id]) => evidence.has(id)).map(([id, hint]) => ({
    role: { id, model: "", ...hint },
    evidence: [...(evidence.get(id) ?? [])].slice(0, 8),
    reason: ["tester", "reviewer"].includes(id)
      ? "Cross-cutting verification role; review whether this project needs a separate specialist."
      : id === "developer"
        ? "No supported domain signal found. Inspect the project and feature scope before choosing a specialist."
        : "Repository signals suggest this expertise. Confirm ownership and tailor the charter before approval.",
  }));
  return {
    suggestions,
    reviewExisting: current.filter((role) => !evidence.has(role.id)).map((role) => ({
      id: role.id,
      reason: "No current built-in signal matches this role. Inspect its actual responsibilities and open work; retain, specialize or explicitly retire it. Missing signals do not prove it is unnecessary.",
    })),
    coverage,
  };
}
