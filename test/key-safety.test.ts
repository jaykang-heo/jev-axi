import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICE_RESPONSE,
  installFakeCurl,
  SENTINEL_KEY,
  withPathPrepended,
} from "./helpers/fake-curl.js";
import { run, tmpdir_, withEnv, writeTmp } from "./helpers/run.js";

/**
 * The non-negotiable: TYPESAFE_API_KEY is sent only as a header read from a
 * file descriptor. It must never appear on argv, in the child environment,
 * in stdout, or in any log/error. Modeled on bin/fm-dispatch-resolve.sh's
 * fake-curl test.
 */
describe("key safety", () => {
  let dir: string;
  let state: string;
  let restorePath: (() => void) | undefined;

  beforeEach(() => {
    dir = tmpdir_();
    state = writeTmp(dir, "state.txt", "The deploy failed after the migration ran.");
  });
  afterEach(() => {
    restorePath?.();
    restorePath = undefined;
  });

  const CHOICE_ARGV = (s: string) => [
    "choice",
    "--state",
    s,
    "--option",
    "a=Rollback the migration",
    "--option",
    "b=Fix forward",
    "--none",
  ];

  it("sends the key via fd 3 only: never on argv, child env, or stdout", async () => {
    const fake = installFakeCurl({ response: DEFAULT_CHOICE_RESPONSE });
    restorePath = withPathPrepended(fake.binDir);

    const r = await withEnv(
      { TYPESAFE_API_KEY: SENTINEL_KEY, HOME: dir },
      () => run(CHOICE_ARGV(state)),
    );
    expect(r.exit).toBe(0);

    // argv carries -H @/dev/fd/3, never the key, never a literal Bearer token
    const argv = fake.read("argv");
    expect(argv).toContain("@/dev/fd/3");
    expect(argv).not.toContain(SENTINEL_KEY);
    expect(argv).not.toMatch(/Bearer\s+\S/);

    // the child environment saw neither the variable name nor the value
    expect(fake.read("env-typescope").trim()).toBe("clean");
    expect(fake.read("env-sentinel").trim()).toBe("clean");

    // fd 3 carried exactly the auth header
    expect(fake.read("fd3")).toBe(`Authorization: Bearer ${SENTINEL_KEY}`);

    // the request body and CLI output carry no key material
    expect(fake.read("body")).not.toContain(SENTINEL_KEY);
    expect(r.stdout).not.toContain(SENTINEL_KEY);

    // and the parent env was scrubbed for any later spawn
    expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
  });

  it("reads the key from ~/.config/jev-axi/env (mode 600) when env is absent", async () => {
    const home = join(dir, "home");
    const cfgDir = join(home, ".config", "jev-axi");
    mkdirSync(cfgDir, { recursive: true });
    const envFile = join(cfgDir, "env");
    writeFileSync(envFile, `TYPESAFE_API_KEY=${SENTINEL_KEY}\n`);
    chmodSync(envFile, 0o600);

    const fake = installFakeCurl({ response: DEFAULT_CHOICE_RESPONSE });
    restorePath = withPathPrepended(fake.binDir);

    const r = await withEnv(
      { TYPESAFE_API_KEY: undefined, HOME: home },
      () => run(CHOICE_ARGV(state)),
    );
    expect(r.exit).toBe(0);
    expect(fake.read("fd3")).toBe(`Authorization: Bearer ${SENTINEL_KEY}`);
    expect(r.stdout).not.toContain(SENTINEL_KEY);
  });

  it("refuses a world-readable config file (mode != 600)", async () => {
    const home = join(dir, "home");
    const cfgDir = join(home, ".config", "jev-axi");
    mkdirSync(cfgDir, { recursive: true });
    const envFile = join(cfgDir, "env");
    writeFileSync(envFile, `TYPESAFE_API_KEY=${SENTINEL_KEY}\n`);
    chmodSync(envFile, 0o644);

    const fake = installFakeCurl();
    restorePath = withPathPrepended(fake.binDir);

    const r = await withEnv(
      { TYPESAFE_API_KEY: undefined, HOME: home },
      () => run(CHOICE_ARGV(state)),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("mode 644");
    expect(r.stdout).not.toContain(SENTINEL_KEY);
  });

  it("reports NO_KEY (exit 2) when no key is configured", async () => {
    const fake = installFakeCurl();
    restorePath = withPathPrepended(fake.binDir);
    const home = join(dir, "empty-home");
    mkdirSync(home, { recursive: true });

    const r = await withEnv(
      { TYPESAFE_API_KEY: undefined, HOME: home },
      () => run(CHOICE_ARGV(state)),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("NO_KEY");
    expect(r.stdout).toContain("TYPESAFE_API_KEY");
  });
});
