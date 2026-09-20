import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICE_RESPONSE,
  installFakeCurl,
  SENTINEL_KEY,
} from "./helpers/fake-curl.js";
import { tmpdir_, writeTmp } from "./helpers/run.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "dist", "bin", "jev-axi.js");

/** Run the compiled dist/bin/jev-axi.js (built by global-setup) with env. */
function cli(
  args: string[],
  env: Record<string, string | undefined> = {},
): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [BIN, ...args], {
      encoding: "utf-8",
      env: { ...process.env, ...env },
    });
    return { stdout, status: 0 };
  } catch (e: any) {
    return { stdout: String(e.stdout ?? "") + String(e.stderr ?? ""), status: e.status ?? 1 };
  }
}

describe("compiled dist/bin/jev-axi.js", () => {
  it("--version fast path prints the version without loading the graph", () => {
    const r = cli(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help lists the commands", () => {
    const r = cli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("commands[7]:");
    expect(r.stdout).toContain("choice");
  });

  it("runs a full choice through the real binary with a fake curl", () => {
    const dir = tmpdir_("jev-axi-e2e-");
    const state = writeTmp(dir, "state.txt", "Deploy broke after the migration.");
    const fake = installFakeCurl({ response: DEFAULT_CHOICE_RESPONSE });
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const r = cli(
      ["choice", "--state", state, "--option", "a=X", "--option", "b=Y", "--none"],
      { PATH: `${fake.binDir}:${process.env.PATH}`, TYPESAFE_API_KEY: SENTINEL_KEY, HOME: home },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("choice: a");
    expect(r.stdout).toContain("model: jev-1.13.0");
    expect(r.stdout).not.toContain(SENTINEL_KEY);
    const body = fake.readJson("body") as any;
    expect(body.questions.q.criteria.none).toBe("Neither of the above / none apply");
    expect(fake.read("env-typescope").trim()).toBe("clean");
  });

  it("setup hooks installs a marked SessionStart hook under HOME", () => {
    const home = tmpdir_("jev-axi-hooks-");
    const r = cli(["setup", "hooks"], { HOME: home });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("status: installed");
    const settings = join(home, ".claude", "settings.json");
    expect(existsSync(settings)).toBe(true);
    const content = readFileSync(settings, "utf-8");
    expect(content).toContain("jev-axi");
    // idempotent: second run neither duplicates nor errors
    const r2 = cli(["setup", "hooks"], { HOME: home });
    expect(r2.status).toBe(0);
  });
});
