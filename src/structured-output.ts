/** The JSON Schema vocabulary used for model output contracts. Each rule is also checked locally. */
export interface OutputSchema {
  type?: "object" | "array" | "string" | "integer" | "null";
  description?: string;
  properties?: Record<string, OutputSchema>;
  required?: string[];
  items?: OutputSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: (string | number | null)[];
  const?: string | number | null;
  anyOf?: OutputSchema[];
}

export interface OutputIssue { path: string; message: string }
export class OutputValidationError extends Error {
  constructor(public readonly issues: OutputIssue[], public readonly repairable = true, public readonly normalizations: OutputIssue[] = []) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
    this.name = "OutputValidationError";
  }
}

function hasType(value: unknown, type: OutputSchema["type"]): boolean {
  if (type === undefined) return true;
  if (type === "null") return value === null;
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

/** Aggregate shape errors without echoing untrusted field values into logs or repair instructions. */
export function outputIssues(value: unknown, schema: OutputSchema, path = "$"): OutputIssue[] {
  if (schema.anyOf) {
    const alternatives = schema.anyOf.map((option) => ({ option, issues: outputIssues(value, option, path) }));
    if (alternatives.some(({ issues }) => !issues.length)) return [];
    const matching = alternatives.filter(({ option }) => hasType(value, option.type));
    const score = ({ option, issues }: { option: OutputSchema; issues: OutputIssue[] }) => issues.length + (option.type === "object"
      ? (option.required ?? []).filter((key) => !Object.hasOwn(value as object, key)).length * 2 : 0);
    if (matching.length) return matching.sort((a, b) => score(a) - score(b))[0]!.issues;
    return [{ path, message: `must be ${schema.anyOf.map((option) => option.type ?? "one allowed shape").join(" or ")}.` }];
  }
  if (!hasType(value, schema.type)) return [{ path, message: `must be ${schema.type}.` }];
  const issues: OutputIssue[] = [];
  const fail = (message: string) => issues.push({ path, message });
  if ("const" in schema && value !== schema.const) fail(`must equal ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value as string | number | null)) fail(`must be one of ${JSON.stringify(schema.enum)}.`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) fail("must contain non-empty text.");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`must match ${schema.pattern}.`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must contain at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must contain at most ${schema.maxItems} item(s).`);
    if (schema.items) value.forEach((item, index) => issues.push(...outputIssues(item, schema.items!, `${path}[${index}]`)));
  }
  if (schema.type === "object") {
    const data = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in data)) issues.push({ path: `${path}.${key}`, message: "is required." });
    for (const [key, field] of Object.entries(schema.properties ?? {})) {
      if (key in data) issues.push(...outputIssues(data[key], field, `${path}.${key}`));
    }
  }
  return issues;
}

/** Add independent semantic checks to the same diagnostics used for shape validation. */
export function outputCheck(issues: OutputIssue[], path: string, check: () => void): void {
  try { check(); }
  catch (error) {
    if (error instanceof OutputValidationError) {
      issues.push(...error.issues.map((issue) => ({ ...issue, path: path + issue.path.slice(1) })));
    } else issues.push({ path, message: error instanceof Error ? error.message : "Validation failed." });
  }
}
