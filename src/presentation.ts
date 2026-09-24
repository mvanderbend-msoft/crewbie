import { stripVTControlCharacters } from "node:util";
import stringWidth from "string-width";
import { json } from "./core.js";

interface OutputStream {
  isTTY?: boolean;
  columns?: number;
  write: (text: string) => unknown;
}
interface OutputOptions {
  stdout?: OutputStream;
  stderr?: OutputStream;
  env?: NodeJS.ProcessEnv;
  machine?: boolean;
}
const codes = { bold: 1, dim: 2, cyan: 36, green: 32, yellow: 33, red: 31 };
type Colour = keyof typeof codes;
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const plain = (value: string) => stripVTControlCharacters(value).replace(/\r\n?/g, "\n");
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
const scalar = (value: unknown): string => value === null ? "null" : value === undefined ? "-" : String(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const simple = (value: unknown) => value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);

export function wrapText(value: string, width: number): string {
  const columns = Math.max(4, Math.floor(width));
  return plain(value).replaceAll("\t", "    ").split("\n").flatMap((line) => {
    const indent = " ".repeat(Math.min(line.match(/^ */)![0].length, Math.max(0, columns - 8)));
    const lines: string[] = [];
    let current = indent;
    for (const { segment } of segments.segment(line.trimStart())) {
      if (stringWidth(current + segment) > columns) {
        const space = current.lastIndexOf(" ");
        if (space > indent.length) {
          lines.push(current.slice(0, space));
          current = indent + current.slice(space + 1);
        } else {
          lines.push(current);
          current = indent;
        }
      }
      if (current !== indent || segment !== " ") current += segment;
    }
    lines.push(current.trimEnd());
    return lines;
  }).join("\n");
}

export function createOutput(options: OutputOptions = {}) {
  const stdout = options.stdout ?? process.stdout, stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const interactive = (stream: OutputStream) => stream.isTTY === true && !options.machine;
  const coloured = (stream: OutputStream) => interactive(stream) && !("NO_COLOR" in env) && env.FORCE_COLOR !== "0" && env.TERM !== "dumb";
  const width = (stream: OutputStream) => Math.max(20, Math.min(stream.columns ?? 100, 120));
  const paint = (value: string, colour: Colour, stream = stdout) => coloured(stream) ? `\u001b[${codes[colour]}m${value}\u001b[0m` : value;
  const status = (value: string) => {
    const state = value.trim().toLowerCase();
    if (["ready", "approved", "done", "success", "completed", "clean"].includes(state)) return paint(value, "green");
    if (["blocked", "failed", "error", "not ready"].includes(state)) return paint(value, "red");
    if (["unknown", "unavailable", "pending", "waiting", "cancelled"].includes(state)) return paint(value, "yellow");
    if (["running", "review"].includes(state)) return paint(value, "cyan");
    return value;
  };
  const decorate = (line: string) => {
    if (/^(?:Crewbie\b|[123]\. (?:Assess|Review|Apply)\b|[A-Z][A-Z /]+(?: \||$)|Installation preview:|Saved for review)/.test(line)) return paint(line, "bold");
    return line.replace(/^(\s*)\[(ready|blocked|unknown)\]/i, (_, indent: string, state: string) => `${indent}[${status(state.toUpperCase())}]`);
  };
  const text = (value: string) => {
    const display = interactive(stdout)
      ? wrapText(value.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/`([^`\n]+)`/g, "$1"), width(stdout)).split("\n").map(decorate).join("\n")
      : value;
    stdout.write(display + "\n");
  };
  function table(rows: Record<string, unknown>[], depth: number): string | null {
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const indent = " ".repeat(Math.min(depth * 2, 8));
    const available = width(stdout) - stringWidth(indent);
    if (!keys.length || keys.length > 5 || keys.length * 10 + (keys.length - 1) * 3 > available
      || rows.some((row) => keys.some((key) => !simple(row[key]) || scalar(row[key]).includes("\n")))) return null;
    const widths = keys.map((key) => Math.min(48, Math.max(10, stringWidth(label(key)), ...rows.map((row) => stringWidth(plain(scalar(row[key])))))));
    while (widths.reduce((sum, size) => sum + size, (keys.length - 1) * 3) > available) {
      const widest = widths.indexOf(Math.max(...widths));
      widths[widest]!--;
    }
    const pad = (value: string, size: number) => value + " ".repeat(Math.max(0, size - stringWidth(value)));
    const headings = keys.map((key, index) => wrapText(label(key).toUpperCase(), widths[index]!).split("\n"));
    const lines: string[] = [];
    for (let line = 0; line < Math.max(...headings.map((cell) => cell.length)); line++) {
      lines.push(paint((indent + headings.map((cell, index) => pad(cell[line] ?? "", widths[index]!)).join(" | ")).trimEnd(), "bold"));
    }
    lines.push(indent + widths.map((size) => "-".repeat(size)).join("-+-"));
    for (const row of rows) {
      const cells = keys.map((key, index) => wrapText(scalar(row[key]), widths[index]!).split("\n"));
      for (let line = 0; line < Math.max(...cells.map((cell) => cell.length)); line++) {
        lines.push((indent + cells.map((cell, index) => status(pad(cell[line] ?? "", widths[index]!)))
          .join(" | ")).trimEnd());
      }
    }
    return lines.join("\n");
  }
  function details(value: unknown, depth = 0): string {
    const indent = " ".repeat(Math.min(depth * 2, 8));
    if (Array.isArray(value)) {
      if (!value.length) return `${indent}(none)`;
      if (value.every(isRecord)) {
        const rendered = table(value, depth);
        if (rendered !== null) return rendered;
      }
      return value.map((item, index) => simple(item)
        ? wrapText(`${indent}- ${scalar(item)}`, width(stdout))
        : `${paint(`${indent}[${index + 1}]`, "dim")}\n${details(item, depth + 1)}`).join("\n");
    }
    if (isRecord(value)) {
      return Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => simple(item)
        ? wrapText(`${indent}${label(key)}: ${scalar(item)}`, width(stdout)).split("\n").map((line) =>
          line.replace(/: ([^:]+)$/, (_, content: string) => `: ${status(content)}`)).join("\n")
        : `${paint(wrapText(`${indent}${label(key).toUpperCase()}`, width(stdout)), "bold")}\n${details(item, depth + 1)}`).join("\n");
    }
    return wrapText(`${indent}${scalar(value)}`, width(stdout));
  }
  return {
    text,
    data: (value: unknown, plainFallback?: string) => stdout.write((interactive(stdout) ? details(value)
      : options.machine ? json(value) : plainFallback ?? json(value)) + "\n"),
    heading: (command: string) => {
      if (interactive(stdout)) stdout.write(`\n${paint("CREWBIE", "cyan")} ${paint("/", "dim")} ${paint(command.toUpperCase(), "bold")}\n\n`);
    },
    error: (message: string) => stderr.write(interactive(stderr)
      ? `\n${paint("ERROR", "red", stderr)} ${paint("Crewbie", "bold", stderr)}\n\n${wrapText(`  ${message}`, width(stderr))}\n`
      : `Crewbie: ${message}\n`),
  };
}
