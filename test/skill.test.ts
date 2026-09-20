import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSkillMarkdown,
  MAX_SKILL_MARKDOWN_CHARS,
} from "../src/skill.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("generated skill", () => {
  it("committed SKILL.md matches the generator output", () => {
    const committed = readFileSync(
      join(root, "skills", "jev-axi", "SKILL.md"),
      "utf-8",
    );
    expect(committed).toBe(createSkillMarkdown());
  });

  it("stays a stub under the character cap", () => {
    expect(createSkillMarkdown().length).toBeLessThanOrEqual(
      MAX_SKILL_MARKDOWN_CHARS,
    );
  });

  it("defers guidance to the CLI", () => {
    const md = createSkillMarkdown();
    expect(md).toContain("jev-axi --help");
    expect(md).toContain("jev-axi <command> --help");
    expect(md).toContain("name: jev-axi");
  });
});
