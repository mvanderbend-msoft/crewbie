import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { errorCode, hash, optionalText, record, safePath } from "../core.js";
import { instructionFile } from "./instruction-quality.js";

export interface Inventory {
  mode: "brownfield" | "greenfield";
  files: { path: string; kind: "instructions" | "agents" | "archive" | "constitution"; content: string; beforeHash: string; redacted: boolean }[];
  mcp: { path: string; servers: { name: string; transport: string; executable: string | null; credentials: string[] }[] }[];
  omitted: { path: string; reason: string }[];
  scope: string;
}

export function redact(text: string): string {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "<REDACTED>")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "<REDACTED>")
    .replace(/((?:token|password|secret|api[_-]?key)\s*["']?\s*[:=]\s*)["']?[^\s"',;}]+/gi, "$1<REDACTED>")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1<REDACTED>@");
}

export async function inventory(root: string, paths: string[]): Promise<Inventory> {
  const implementation = paths.filter((path) => !/(^|\/)(?:\.git|\.github|\.crewbie|\.claude|\.copilot|node_modules|vendor|dist|build|coverage|test|tests|docs)\//.test(path)
    && /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|rb|php|swift|kt|tf|bicep|vue|svelte)$/.test(path));
  const result: Inventory = {
    mode: implementation.length ? "brownfield" : "greenfield", files: [], mcp: [], omitted: [],
    scope: "AI guidance only: agent instructions, custom agents, constitution and MCP metadata, bounded to 256 KB of text. Application code, READMEs, manifests and other project files are not read. Ignored files and personal/global MCP settings are not read. MCP configurations are inspected, never launched; arguments, URLs, headers and credential values are withheld. Builds and server availability are unverified.",
  };
  const mcpPaths = paths.filter((path) => /(^|\/)(?:mcp\.json|mcp-config\.json|\.mcp\.json)$/.test(path) || path === ".vscode/settings.json");
  const guidance = paths.filter((path) => instructionFile(path) || /^\.crewbie\/agent-archive\/(?:github|claude)\/agents\/.*\.md$/.test(path) || /(^|\/)constitution\.md$/i.test(path));
  const candidates = [...new Set([...guidance, ...mcpPaths])];
  let remaining = 256_000;
  for (const path of candidates) {
    const absolute = await safePath(root, path);
    let size: number;
    try { size = (await stat(absolute)).size; }
    catch (error) {
      if (!errorCode(error, "ENOENT")) throw error;
      result.omitted.push({ path, reason: "File disappeared during assessment." }); continue;
    }
    if (size > 64_000 || size > remaining) {
      result.omitted.push({ path, reason: "File exceeds the text assessment budget or is not ordinary text." }); continue;
    }
    const content = await optionalText(absolute);
    if (content === null || content.includes("\0")) { result.omitted.push({ path, reason: "File disappeared or is not ordinary text." }); continue; }
    remaining -= size;
    if (mcpPaths.includes(path)) {
      try {
        const errors: ParseError[] = [];
        const parsed: unknown = parse(content, errors, { allowTrailingComma: true });
        if (errors.length) throw new SyntaxError("Invalid MCP JSON.");
        const config = record(parsed, "MCP configuration");
        const nested = config.mcp === undefined ? config : record(config.mcp, "MCP settings");
        const servers = record(nested.mcpServers ?? nested.servers ?? {}, "MCP servers");
        result.mcp.push({ path, servers: Object.entries(servers).map(([name, raw]) => {
          const server = record(raw, "MCP server");
          return {
            name: redact(name), transport: typeof server.type === "string" ? redact(server.type) : server.command ? "stdio" : "remote",
            executable: typeof server.command === "string" ? redact(basename(server.command.replaceAll("\\", "/"))) : null,
            credentials: Object.keys(record(server.env ?? {}, "MCP environment")).map(redact),
          };
        }) });
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof Error && /must be an object/.test(error.message))) throw error;
        result.omitted.push({ path, reason: "MCP configuration is not valid JSON/JSONC; inspect manually. Raw configuration was not shared." });
      }
      continue;
    }
    const safe = redact(content);
    result.files.push({
      path, kind: /(^|\/)constitution\.md$/i.test(path) ? "constitution" : path.startsWith(".crewbie/agent-archive/") ? "archive" : /(^|\/)(?:\.github|\.claude)\/agents\//.test(path) ? "agents" : "instructions",
      content: safe, beforeHash: hash(content), redacted: safe !== content,
    });
  }
  return result;
}
