import { GitHubError, record } from "../core.js";
import { setTimeout } from "node:timers/promises";

export interface GitHubApi {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
  list(path: string): Promise<Record<string, unknown>[]>;
}
export function isApprover(value: unknown, approvers: string[]): boolean {
  if (value === null || value === undefined) return false;
  const user = record(value, "GitHub author");
  return user.type === "User" && typeof user.login === "string" && approvers.includes(user.login);
}
export function api(token: string, fetcher: typeof fetch = fetch): GitHubApi {
  if (!token.trim()) throw new Error("A GitHub user-authorized credential is required.");
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) throw new Error("GitHub requests must use an API-relative path.");
    const readOnly = method === "GET" || (method === "POST" && path === "/graphql"
      && typeof body === "object" && body !== null && "query" in body && typeof body.query === "string"
      && /^\s*query(?:\s|\()/.test(body.query) && !/\bmutation\b/.test(body.query));
    for (let attempt = 0; ; attempt++) {
    const response = await fetcher(`https://api.github.com${path}`, {
      method, headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (readOnly && attempt < 2 && [502, 503, 504].includes(response.status)) {
        const retryAfter = response.headers.get("retry-after");
        const wait = retryAfter === null ? 1000 * 2 ** attempt
          : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
        if (Number.isFinite(wait) && wait <= 30_000) {
          console.warn(`Crewbie: transient HTTP ${response.status} reading ${path}; retry ${attempt + 1}/2 in ${wait}ms.`);
          await setTimeout(wait);
          continue;
        }
      }
      const error = new GitHubError(response.status, response.headers.get("x-github-request-id"));
      error.message += ` Operation: ${method} ${path}.`;
      throw error;
    }
    if (response.status === 204) return null;
    if (response.status === 202) {
      const text = await response.text();
      return text.trim() ? JSON.parse(text) as unknown : null;
    }
    return response.json();
    }
  }
  return {
    request,
    async list(path) {
      const all: Record<string, unknown>[] = [];
      for (let page = 1; page <= 100; page++) {
        const value = await request("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
        if (!Array.isArray(value)) throw new Error("GitHub returned an invalid paginated response.");
        all.push(...value.map((item) => record(item, "GitHub list item")));
        if (value.length < 100) return all;
      }
      throw new Error("GitHub pagination exceeded the safety limit. Narrow the requested data.");
    },
  };
}
export async function requireApprover(client: GitHubApi, approvers: string[]): Promise<string> {
  const user = record(await client.request("GET", "/user"), "authenticated user");
  if (!isApprover(user, approvers) || typeof user.login !== "string") {
    throw new Error("This credential must belong to a configured human approver.");
  }
  return user.login;
}
