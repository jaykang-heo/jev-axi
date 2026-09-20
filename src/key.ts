import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";

export const ENV_KEY = "TYPESAFE_API_KEY";

let capturedKey: string | undefined;

export function envPath(): string {
  return join(homedir(), ".config", "jev-axi", "env");
}

/**
 * Snapshot TYPESAFE_API_KEY out of the environment into module state and
 * scrub the env entry, so a curl (or npm, or gh) spawned later can never
 * inherit it. Runs from runAxiCli's initialize before any command handler.
 * Re-reads on every call so repeat main() invocations see current env.
 */
export function captureEnvironmentKey(env: NodeJS.ProcessEnv = process.env): void {
  const value = env[ENV_KEY];
  capturedKey = typeof value === "string" && value.trim() !== "" ? value : undefined;
  delete env[ENV_KEY];
}

export type KeySource =
  | { kind: "environment" }
  | { kind: "config"; path: string }
  | { kind: "absent" }
  | { kind: "refused"; detail: string };

function readConfigKey(): { key: string } | { refused: string } | undefined {
  const path = envPath();
  if (!existsSync(path)) return undefined;
  const stat = statSync(path);
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    return {
      refused: `config file ${path} has mode ${mode.toString(8).padStart(3, "0")}, expected 600`,
    };
  }
  const text = readFileSync(path, "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY=(.*)$/);
    if (!m) continue;
    const value = m[1].trim().replace(/^['"]|['"]$/g, "");
    if (value === "") continue;
    return { key: value };
  }
  return { refused: `no TYPESAFE_API_KEY= line found in ${path}` };
}

/** Where the key would come from, without exposing its value. */
export function keyStatus(): KeySource {
  if (capturedKey !== undefined) return { kind: "environment" };
  const cfg = readConfigKey();
  if (cfg === undefined) return { kind: "absent" };
  if ("refused" in cfg) return { kind: "refused", detail: cfg.refused };
  return { kind: "config", path: envPath() };
}

/**
 * Resolve the API key: environment first, then ~/.config/jev-axi/env.
 * Never accepts it from argv; never logs it; throws NO_KEY with corrective
 * suggestions when absent or refused.
 */
export function resolveKey(): string {
  if (capturedKey !== undefined) return capturedKey;
  const cfg = readConfigKey();
  if (cfg && "key" in cfg) return cfg.key;
  if (cfg && "refused" in cfg) {
    throw new AxiError(cfg.refused, "NO_KEY", [
      `chmod 600 ${envPath()}`,
      `export ${ENV_KEY}=<key>`,
    ]);
  }
  throw new AxiError(
    `${ENV_KEY} is not set and ${envPath()} does not exist`,
    "NO_KEY",
    [
      `export ${ENV_KEY}=<key>`,
      `mkdir -p ${join(homedir(), ".config", "jev-axi")} && printf 'TYPESAFE_API_KEY=<key>\\n' > ${envPath()} && chmod 600 ${envPath()}`,
    ],
  );
}
