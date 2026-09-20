import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { run, tmpdir_, withEnv } from "./helpers/run.js";

describe("entrypoints", () => {
  it("--version / -v / -V print the version and exit 0", async () => {
    for (const flag of ["--version", "-v", "-V"]) {
      const r = await run([flag]);
      expect(r.exit).toBe(0);
      expect(r.stdout.trim()).toBe(VERSION);
    }
  });

  it("leading flags error with exit 2", async () => {
    const r = await run(["--state", "x"]);
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("Flags must come after the command");
  });

  it("dashboard reports key presence, model pin, and examples", async () => {
    const home = tmpdir_();
    mkdirSync(join(home, ".config", "jev-axi"), { recursive: true });
    const envFile = join(home, ".config", "jev-axi", "env");
    writeFileSync(envFile, "TYPESAFE_API_KEY=abc\n");
    chmodSync(envFile, 0o600);

    const r = await withEnv({ TYPESAFE_API_KEY: undefined, HOME: home }, () => run([]));
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("key: present (~/.config/jev-axi/env)");
    expect(r.stdout).toContain("model: jev-1.13.0 (pinned)");
    expect(r.stdout).toContain("api.typesafe.ai");
    expect(r.stdout).toContain("jev-axi choice");
  });

  it("dashboard reports key absent without env or config", async () => {
    const home = tmpdir_();
    const r = await withEnv({ TYPESAFE_API_KEY: undefined, HOME: home }, () => run([]));
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("key: absent");
  });
});
