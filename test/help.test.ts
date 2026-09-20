import { describe, expect, it } from "vitest";
import { FLAGS as ASK_FLAGS, HELP as ASK_HELP } from "../src/commands/ask.js";
import { FLAGS as CHOICE_FLAGS, HELP as CHOICE_HELP } from "../src/commands/choice.js";
import { FLAGS as NOUL_FLAGS, HELP as NOUL_HELP } from "../src/commands/noul.js";
import { FLAGS as SCORE_FLAGS, HELP as SCORE_HELP } from "../src/commands/score.js";
import { SETUP_HELP } from "../src/commands/setup.js";
import { UPDATE_HELP } from "../src/commands/update.js";
import { TOP_HELP } from "../src/cli.js";
import { run } from "./helpers/run.js";

const COMMAND_FLAGS: Record<string, { flags: readonly string[]; help: string }> = {
  choice: { flags: CHOICE_FLAGS, help: CHOICE_HELP },
  noul: { flags: NOUL_FLAGS, help: NOUL_HELP },
  score: { flags: SCORE_FLAGS, help: SCORE_HELP },
  ask: { flags: ASK_FLAGS, help: ASK_HELP },
};

describe("help contract", () => {
  it("top-level help lists every command and the shared flags", async () => {
    const r = await run(["--help"]);
    expect(r.exit).toBe(0);
    for (const cmd of ["choice", "noul", "score", "ask", "setup", "update"])
      expect(r.stdout).toContain(cmd);
    for (const f of ["--state", "--timeout", "--model", "--json", "--help", "--version"])
      expect(r.stdout).toContain(f);
    expect(r.stdout).toContain("examples:");
    // we own update - the SDK's npm-registry built-in footer must not appear
    expect(r.stdout).not.toContain("built-in");
  });

  it("top-level help describes typed judgment, not prose generation", () => {
    expect(TOP_HELP).toContain("jev-axi");
  });

  for (const [cmd, { flags, help }] of Object.entries(COMMAND_FLAGS)) {
    it(`jev-axi ${cmd} --help documents every accepted flag and examples`, async () => {
      const r = await run([cmd, "--help"]);
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe(help);
      for (const flag of flags) {
        if (flag === "-h") continue;
        expect(help).toContain(flag);
      }
      expect(help).toContain("usage:");
      expect(help).toContain("examples:");
    });
  }

  it("per-command help short-circuits even when required flags are missing", async () => {
    for (const cmd of Object.keys(COMMAND_FLAGS)) {
      const r = await run([cmd, "--help"]);
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("usage:");
    }
  });

  it("setup and update have help", () => {
    expect(SETUP_HELP).toContain("jev-axi setup hooks");
    expect(UPDATE_HELP).toContain("github:jaykang-heo/jev-axi");
  });
});
