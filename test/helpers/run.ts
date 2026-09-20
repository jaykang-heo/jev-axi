import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.js";

export interface RunResult {
  stdout: string;
  exit: number;
}

/** Invoke the CLI in-process with captured stdout; returns exit code. */
export async function run(argv: string[]): Promise<RunResult> {
  process.exitCode = undefined;
  let buf = "";
  await main({ argv, stdout: { write: (c) => (buf += String(c), true) } });
  return { stdout: buf, exit: process.exitCode ?? 0 };
}

export function tmpdir_(prefix = "jev-axi-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeTmp(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

/** Apply env vars for the duration of a callback; restores on return. */
export async function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of Object.keys(patch)) {
    saved.set(k, process.env[k]);
    const v = patch[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
