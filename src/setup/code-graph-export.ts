import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

const DEFAULT_LIMITS = { maxBytes: 256_000_000, maxValueBytes: 1_000_000, maxDepth: 64 };
const CHUNK_BYTES = 64 * 1024;

export interface CodeGraphExportLimits {
  maxBytes?: number;
  maxValueBytes?: number;
  maxDepth?: number;
}

class ExportError extends Error {}

function invalid(): never {
  throw new ExportError("Invalid CodeGraph export JSON. No assessment was sent; raw tool output was withheld.");
}

function valueBudget(bytes: number, limit: number): void {
  if (bytes > limit) throw new ExportError(`CodeGraph export value is ${bytes} bytes; the buffered value limit is ${limit} bytes. No assessment was sent.`);
}

type Token = { kind: "string" | "number" | "literal" | "punctuation" | "whitespace"; raw: string; bytes: number };
const whitespace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;
const numberCharacter = (code: number): boolean => code >= 48 && code <= 57 || code === 45 || code === 43 || code === 46 || code === 69 || code === 101;

/** Synchronous chunk scanning: no per-character promises and no whole-export string. */
class Tokenizer {
  private mode: "string" | "number" | "literal" | undefined;
  private parts: string[] = [];
  private bytes = 0;
  private escaped = false;
  private hexLeft = 0;
  private literal = "";
  private literalOffset = 0;

  constructor(private readonly limit: number) {}

  private append(part: string): void {
    this.bytes += Buffer.byteLength(part);
    valueBudget(this.bytes, this.limit);
    this.parts.push(part);
  }

  private complete(kind: Token["kind"]): Token {
    const token = { kind, raw: this.parts.join(""), bytes: this.bytes };
    this.parts = []; this.bytes = 0; this.mode = undefined;
    if (kind === "number" && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token.raw)) invalid();
    return token;
  }

  *write(text: string): Generator<Token> {
    let offset = 0;
    while (offset < text.length) {
      let start = offset;
      if (this.mode === undefined) {
        const char = text[offset]!;
        if (whitespace(text.charCodeAt(offset))) {
          do { offset++; } while (offset < text.length && whitespace(text.charCodeAt(offset)));
          yield { kind: "whitespace", raw: text.slice(start, offset), bytes: offset - start };
          continue;
        }
        if ("{}[]:,".includes(char)) {
          offset++;
          yield { kind: "punctuation", raw: char, bytes: 1 };
          continue;
        }
        if (char === '"') { this.mode = "string"; offset++; }
        else if (char === "-" || char >= "0" && char <= "9") this.mode = "number";
        else if (char === "t" || char === "f" || char === "n") {
          this.mode = "literal";
          this.literal = char === "t" ? "true" : char === "f" ? "false" : "null";
          this.literalOffset = 0;
        } else invalid();
      }
      if (this.mode === "string") {
        let complete = false;
        while (offset < text.length) {
          const char = text[offset++]!;
          if (this.hexLeft) {
            if (!/^[0-9a-fA-F]$/.test(char)) invalid();
            this.hexLeft--;
          } else if (this.escaped) {
            this.escaped = false;
            if (char === "u") this.hexLeft = 4;
            else if (!'"\\/bfnrt'.includes(char)) invalid();
          } else if (char === "\\") this.escaped = true;
          else if (char === '"') { complete = true; break; }
          else if (char.charCodeAt(0) < 32) invalid();
        }
        this.append(text.slice(start, offset));
        if (complete) yield this.complete("string");
      } else if (this.mode === "number") {
        while (offset < text.length && numberCharacter(text.charCodeAt(offset))) offset++;
        this.append(text.slice(start, offset));
        if (offset < text.length) yield this.complete("number");
      } else if (this.mode === "literal") {
        while (offset < text.length && this.literalOffset < this.literal.length) {
          if (text[offset++] !== this.literal[this.literalOffset++]) invalid();
        }
        this.append(text.slice(start, offset));
        if (this.literalOffset === this.literal.length) yield this.complete("literal");
      }
    }
  }

  *finish(): Generator<Token> {
    if (this.mode === "number") yield this.complete("number");
    else if (this.mode !== undefined) invalid();
  }
}

type GraphKind = "nodes" | "edges";
type ObjectFrame = { type: "object"; state: "keyOrEnd" | "key" | "colon" | "value" | "commaOrEnd"; key?: string };
type ArrayFrame = { type: "array"; state: "valueOrEnd" | "value" | "commaOrEnd"; graph?: GraphKind };
type Frame = ObjectFrame | ArrayFrame;

/** Validates all JSON, while retaining just one graph record. Metadata is discarded token by token. */
class GraphParser {
  private readonly stack: Frame[] = [];
  private readonly keys = new Set<string>();
  private keyBytes = 0;
  private started = false;
  private finished = false;
  private capture: { depth: number; parts: string[]; bytes: number; kind: GraphKind } | undefined;

  constructor(private readonly kind: GraphKind, private readonly limit: number, private readonly maxDepth: number) {}

  private append(token: Token): void {
    if (!this.capture) return;
    this.capture.bytes += token.bytes;
    valueBudget(this.capture.bytes, this.limit);
    this.capture.parts.push(token.raw);
  }

  private valueFinished(): void {
    const parent = this.stack.at(-1);
    if (parent) parent.state = "commaOrEnd";
    else this.finished = true;
  }

  private push(frame: Frame): void {
    if (this.stack.length >= this.maxDepth) throw new ExportError(`CodeGraph export exceeds the nesting limit of ${this.maxDepth}. No assessment was sent.`);
    this.stack.push(frame);
  }

  accept(token: Token): Record<string, unknown> | undefined {
    this.append(token);
    if (token.kind === "whitespace") return;
    if (this.finished) invalid();
    if (!this.started) {
      if (token.raw !== "{") invalid();
      this.started = true;
      this.push({ type: "object", state: "keyOrEnd" });
      return;
    }
    const frame = this.stack.at(-1)!;
    const objectEnd = token.raw === "}" && frame.type === "object" && (frame.state === "keyOrEnd" || frame.state === "commaOrEnd");
    const arrayEnd = token.raw === "]" && frame.type === "array" && (frame.state === "valueOrEnd" || frame.state === "commaOrEnd");
    if (objectEnd || arrayEnd) {
      let result: Record<string, unknown> | undefined;
      if (this.capture?.depth === this.stack.length) {
        // Even unselected records have a size limit and must be valid object JSON.
        if (this.capture.kind === this.kind) {
          try { result = JSON.parse(this.capture.parts.join("")) as Record<string, unknown>; }
          catch { invalid(); }
        }
        this.capture = undefined;
      }
      this.stack.pop();
      this.valueFinished();
      return result;
    }
    if (frame.type === "object" && (frame.state === "keyOrEnd" || frame.state === "key")) {
      if (token.kind !== "string") invalid();
      if (this.stack.length === 1) {
        const key = JSON.parse(token.raw) as string;
        if (this.keys.has(key)) invalid();
        // Include an allowance per entry so many tiny distinct names cannot grow the Set without bound.
        this.keyBytes += token.bytes + 32;
        valueBudget(this.keyBytes, this.limit);
        this.keys.add(key);
        frame.key = key;
      }
      frame.state = "colon";
      return;
    }
    if (frame.state === "colon") {
      if (token.raw !== ":") invalid();
      frame.state = "value";
      return;
    }
    if (frame.state === "commaOrEnd") {
      if (token.raw !== ",") invalid();
      frame.state = frame.type === "object" ? "key" : "value";
      return;
    }
    if (frame.state !== "value" && frame.state !== "valueOrEnd") invalid();
    const graph = this.stack.length === 1 && frame.type === "object" && (frame.key === "nodes" || frame.key === "edges") ? frame.key : undefined;
    if (graph && token.raw !== "[") invalid();
    if (frame.type === "array" && frame.graph) {
      if (token.raw !== "{") invalid();
      this.capture = { depth: this.stack.length + 1, parts: [], bytes: 0, kind: frame.graph };
      this.append(token);
    }
    if (token.raw === "{") this.push({ type: "object", state: "keyOrEnd" });
    else if (token.raw === "[") this.push({ type: "array", state: "valueOrEnd", ...(graph ? { graph } : {}) });
    else if (token.kind === "string" || token.kind === "number" || token.kind === "literal") this.valueFinished();
    else invalid();
    return;
  }

  finish(): void {
    if (!this.finished || this.stack.length || !this.keys.has("nodes") || !this.keys.has("edges")) invalid();
  }
}

/**
 * Stream one record array; consume the generator fully to validate the entire export.
 * Run separate passes for nodes and edges so their order in the export is immaterial.
 * Optional lower limits are for offline tests, not CLI-configurable budget increases.
 */
export async function* readCodeGraphRecords(path: string, kind: GraphKind, options: CodeGraphExportLimits = {}): AsyncGenerator<Record<string, unknown>> {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const key of ["maxBytes", "maxValueBytes", "maxDepth"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > DEFAULT_LIMITS[key]) throw new ExportError("Invalid CodeGraph export reader limits.");
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await lstat(path);
    if (!before.isFile()) throw new ExportError("CodeGraph export must be a regular file (symlinks are not allowed). No assessment was sent.");
    if (before.size > limits.maxBytes) throw new ExportError(`CodeGraph export is ${before.size} bytes; the input limit is ${limits.maxBytes} bytes. No assessment was sent.`);
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const initial = await handle.stat();
    if (!initial.isFile()) throw new ExportError("CodeGraph export must be a regular file (symlinks are not allowed). No assessment was sent.");
    if (initial.size > limits.maxBytes) throw new ExportError(`CodeGraph export is ${initial.size} bytes; the input limit is ${limits.maxBytes} bytes. No assessment was sent.`);
    if (initial.dev !== before.dev || initial.ino !== before.ino || initial.size !== before.size) throw new ExportError("CodeGraph export changed while opening it. No assessment was sent.");
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const tokenizer = new Tokenizer(limits.maxValueBytes);
    const parser = new GraphParser(kind, limits.maxValueBytes, limits.maxDepth);
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limits.maxBytes) throw new ExportError(`CodeGraph export is at least ${total} bytes; the input limit is ${limits.maxBytes} bytes. No assessment was sent.`);
      let text: string;
      try { text = decoder.decode(buffer.subarray(0, bytesRead), { stream: true }); }
      catch { invalid(); }
      for (const token of tokenizer.write(text)) {
        const value = parser.accept(token);
        if (value !== undefined) yield value;
      }
    }
    try { decoder.decode(); } catch { invalid(); }
    for (const token of tokenizer.finish()) {
      const value = parser.accept(token);
      if (value !== undefined) yield value;
    }
    parser.finish();
    const final = await handle.stat();
    if (total !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs) throw new ExportError("CodeGraph export changed while reading it. No assessment was sent.");
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("Unable to read the CodeGraph export safely. No assessment was sent; file details were withheld.");
  } finally {
    await handle?.close().catch(() => { /* Do not disclose OS diagnostics or paths. */ });
  }
}
