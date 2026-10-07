import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { explicitModel } from "./copilot.js";
import { redact } from "./inventory.js";

const run = promisify(execFile);
export const TOOL_FREE_COPILOT_ARGS = ["--no-custom-instructions", "--disable-builtin-mcps", "--available-tools", "--silent", "--deny-tool", "shell", "write", "url"];

/** Same restricted CLI as hosted planning; no shell interpolation, model fallback or transport retries. */
export async function planningCliCompletion(executable: string, root: string, prompt: string, model: string): Promise<string> {
  if (!isAbsolute(executable)) throw new Error("CREWBIE_COPILOT_BIN must be the approved CLI's absolute path.");
  explicitModel(model);
  try {
    const { stdout } = await run(executable, ["--model", model, ...TOOL_FREE_COPILOT_ARGS, "--prompt", prompt], {
      cwd: root, encoding: "utf8", timeout: 150_000, maxBuffer: 100_000,
      env: { ...process.env, COPILOT_AUTO_UPDATE: "false" },
    });
    return stdout;
  } catch (error) {
    // execFile's error.message includes the prompt. Report only a bounded, redacted stderr diagnostic.
    const failed = error as { code?: string | number; signal?: string; stderr?: string };
    throw new Error(`Copilot CLI exited (${failed.signal ?? failed.code ?? "runtime error"}). ${redact(failed.stderr ?? "").slice(0, 1000)}`);
  }
}
