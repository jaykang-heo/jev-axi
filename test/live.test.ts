import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, tmpdir_ } from "./helpers/run.js";
import { DEFAULT_MODEL } from "../src/request.js";

/**
 * Live smoke test against the real API. Runs only when explicitly armed:
 *   JEV_AXI_LIVE=1 TYPESAFE_API_KEY=... pnpm test
 * Asserts the pinned model actually answers, on one Choice and one Noul call.
 */
const LIVE = process.env.JEV_AXI_LIVE === "1";
const describeLive = LIVE ? describe : describe.skip;

describeLive("live API", () => {
  it("choice returns a typed answer from the pinned model", async () => {
    const dir = tmpdir_("jev-axi-live-");
    const state = writeTmp(
      dir,
      "state.txt",
      "The service started returning 502s immediately after the database migration completed.",
    );
    const r = await run([
      "choice",
      "--state",
      state,
      "--option",
      "migration=The migration caused the outage",
      "--option",
      "coincidence=The outage is unrelated to the migration",
      "--none",
      "--timeout",
      "30",
    ]);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain(`model: ${DEFAULT_MODEL}`);
    expect(r.stdout).toMatch(/choice: (migration|coincidence|none)/);
    expect(r.stdout).toContain("confidence:");
    expect(r.stdout).toContain("winning_probability:");
  }, 60_000);

  it("noul returns a probability from the pinned model", async () => {
    const dir = tmpdir_("jev-axi-live-");
    const state = writeTmp(dir, "state.txt", "Two plus two equals four.");
    const r = await run([
      "noul",
      "--state",
      state,
      "--ask",
      "The statement in the state is true",
      "--timeout",
      "30",
    ]);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain(`model: ${DEFAULT_MODEL}`);
    expect(r.stdout).toMatch(/noul: [01](\.\d+)?/);
  }, 60_000);
});
