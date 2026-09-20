import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillMarkdown } from "../src/skill.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "skills", "jev-axi", "SKILL.md");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, createSkillMarkdown());
console.log(`wrote ${out}`);
