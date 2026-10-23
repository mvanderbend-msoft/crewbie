import { json, record, string, strings } from "../core.js";
import { containsSecret } from "./inventory.js";

/** A reviewed MCP server proposal. Secrets are referenced by name only; values never enter files or prompts. */
export interface McpServer {
  name: string;
  purpose: string;
  type: "local" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** Environment variable names a local server needs as secrets. */
  env: string[];
  /** Secret name sent as an Authorization bearer token to an http server. */
  bearerSecret?: string;
  tools: string[];
  /** Also recommended for Copilot cloud agent (repository MCP settings). */
  cloud: boolean;
}

export const MCP_FILE = ".vscode/mcp.json";
// Package runners only: a reviewed name and pinned arguments, never an arbitrary shell command.
const COMMANDS = new Set(["npx", "uvx", "docker"]);
const SECRET = /^[A-Z][A-Z0-9_]{1,63}$/;
// Copilot cloud agent enables these by default.
const CLOUD_DEFAULTS = new Set(["github", "playwright"]);

export function parseMcpServers(value: unknown, configured: readonly string[] = []): McpServer[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("mcpServers must be a list.");
  if (value.length > 6) throw new Error("Propose at most six MCP servers.");
  const names = new Set<string>();
  return value.map((raw) => {
    const server = record(raw, "proposed MCP server");
    if (containsSecret(JSON.stringify(server))) throw new Error("A proposed MCP server appears to contain a secret.");
    const name = string(server.name, "MCP server name");
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw new Error(`MCP server name ${JSON.stringify(name)} must use lowercase letters, digits and hyphens.`);
    if (names.has(name) || configured.includes(name)) throw new Error(`MCP server ${name} is duplicated or already configured.`);
    names.add(name);
    const purpose = string(server.purpose, `${name} MCP purpose`);
    const env = server.env == null ? [] : strings(server.env, `${name} MCP env`);
    const tools = server.tools == null ? ["*"] : strings(server.tools, `${name} MCP tools`);
    if (!tools.length || tools.some((tool) => !/^(?:\*|[A-Za-z0-9_.-]{1,64})$/.test(tool))) throw new Error(`${name} MCP tools must be tool names or "*".`);
    for (const secret of env) if (!SECRET.test(secret)) throw new Error(`${name} MCP secret ${JSON.stringify(secret)} must be an UPPER_SNAKE_CASE name.`);
    const cloud = server.cloud === true && !CLOUD_DEFAULTS.has(name);
    if (server.type === "local" || server.type === "stdio") {
      const command = string(server.command, `${name} MCP command`);
      if (!COMMANDS.has(command)) throw new Error(`${name} MCP command must be npx, uvx or docker; other commands need manual review.`);
      const args = strings(server.args ?? [], `${name} MCP args`);
      if (args.length > 20 || args.some((arg) => /[\r\n$`]/.test(arg) || arg.length > 200)) throw new Error(`${name} MCP args must be at most twenty plain arguments without substitutions.`);
      if (server.url != null || server.bearerSecret != null) throw new Error(`Local MCP server ${name} cannot have a URL or bearer secret.`);
      return { name, purpose, type: "local" as const, command, args, env, tools, cloud };
    }
    if (server.type !== "http") throw new Error(`${name} MCP type must be local or http.`);
    let url: URL;
    try { url = new URL(string(server.url, `${name} MCP URL`)); } catch { throw new Error(`${name} MCP URL must be a valid https URL.`); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${name} MCP URL must be https without credentials.`);
    if (env.length || server.command != null) throw new Error(`HTTP MCP server ${name} cannot have a command or environment.`);
    const bearer = server.bearerSecret == null ? undefined : string(server.bearerSecret, `${name} MCP bearer secret`);
    if (bearer !== undefined && !SECRET.test(bearer)) throw new Error(`${name} MCP bearer secret must be an UPPER_SNAKE_CASE name.`);
    return { name, purpose, type: "http" as const, url: url.toString(), env, tools, cloud, ...(bearer ? { bearerSecret: bearer } : {}) };
  });
}

const inputId = (server: string, secret: string) => `${server}-${secret.toLowerCase().replaceAll("_", "-")}`;
const cloudSecret = (secret: string) => secret.startsWith("COPILOT_MCP_") ? secret : `COPILOT_MCP_${secret}`;

/** VS Code / Copilot local configuration; secrets are prompted at start and never written. */
export function vscodeMcpConfig(servers: readonly McpServer[]): string {
  const inputs: { type: "promptString"; id: string; description: string; password: true }[] = [];
  const configured: Record<string, unknown> = {};
  for (const server of servers) {
    const secrets = [...server.env, ...(server.bearerSecret ? [server.bearerSecret] : [])];
    for (const secret of secrets) inputs.push({ type: "promptString", id: inputId(server.name, secret), description: `${server.name}: ${secret}`, password: true });
    configured[server.name] = server.type === "local"
      ? { type: "stdio", command: server.command, args: server.args ?? [], ...(server.env.length ? { env: Object.fromEntries(server.env.map((secret) => [secret, `\${input:${inputId(server.name, secret)}}`])) } : {}) }
      : { type: "http", url: server.url, ...(server.bearerSecret ? { headers: { Authorization: `Bearer \${input:${inputId(server.name, server.bearerSecret)}}` } } : {}) };
  }
  return json({ ...(inputs.length ? { inputs } : {}), servers: configured });
}

/** JSON for Settings > Copilot > MCP servers, or null when no server suits the cloud agent. */
export function cloudMcpConfig(servers: readonly McpServer[]): { config: string; secrets: string[] } | null {
  const cloud = servers.filter((server) => server.cloud);
  if (!cloud.length) return null;
  const secrets = cloud.flatMap((server) => [...server.env, ...(server.bearerSecret ? [server.bearerSecret] : [])].map(cloudSecret));
  return {
    secrets,
    config: json({ mcpServers: Object.fromEntries(cloud.map((server) => [server.name, server.type === "local"
      ? { type: "local", command: server.command, args: server.args ?? [], tools: server.tools, ...(server.env.length ? { env: Object.fromEntries(server.env.map((secret) => [secret, `$${cloudSecret(secret)}`])) } : {}) }
      : { type: "http", url: server.url, tools: server.tools, ...(server.bearerSecret ? { headers: { Authorization: `Bearer $${cloudSecret(server.bearerSecret)}` } } : {}) }])) }),
  };
}

export function cloudMcpInstructions(repository: string, cloud: { secrets: string[] }): string {
  return `Paste into ${repository || "the repository"} Settings > Copilot > MCP servers (GitHub and Playwright are already enabled there).${cloud.secrets.length ? ` Add these as Agents secrets: ${cloud.secrets.join(", ")}.` : ""}`;
}
