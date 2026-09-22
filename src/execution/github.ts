import { api } from "../tracking/github.js";
export { GitHubError } from "../core.js";
export type JsonObject = Record<string, unknown>;

export function object(value: unknown, context: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${context}.`);
  }
  return value as JsonObject;
}

export function text(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`GitHub returned an invalid ${context}.`);
  }
  return value;
}

export interface GitHubReader {
  get(path: string): Promise<unknown>;
  query(query: string, variables: JsonObject): Promise<unknown>;
}

export function githubReader(token: string, fetcher: typeof fetch = fetch): GitHubReader {
  const client = api(token, fetcher);
  return {
    get: (path) => client.request("GET", path),
    async query(query, variables) {
      const result = object(await client.request("POST", "/graphql", { query, variables }), "GraphQL response");
      if (result.errors !== undefined) {
        if (!Array.isArray(result.errors) || result.errors.length > 0) {
          throw new Error("GitHub GraphQL could not complete the capability check. Check access and API compatibility.");
        }
      }
      return object(result.data, "GraphQL data");
    },
  };
}

export function repositoryName(value: string): { owner: string; name: string; fullName: string } {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]*))\/([A-Za-z0-9_.-]+)$/.exec(value);
  if (!match || !match[1] || !match[2] || match[2] === "." || match[2] === "..") {
    throw new Error("Use a GitHub repository name such as owner/repository, not a URL or path.");
  }
  return { owner: match[1], name: match[2], fullName: `${match[1]}/${match[2]}` };
}

export function agentName(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error("Use an agent filename stem containing lowercase letters, digits, or hyphens.");
  }
  return value;
}
