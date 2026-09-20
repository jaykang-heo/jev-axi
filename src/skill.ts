import { DESCRIPTION } from "./cli.js";

// Trigger string agents match against to auto-load the skill.
export const SKILL_DESCRIPTION =
  "Ask TypeSafe's Jev for a typed judgment about a text through the jev-axi CLI - " +
  "pick one option from a closed set (choice), get a yes/no probability (noul), " +
  "or rate a text against a rubric (score), several questions in parallel on one " +
  "call (ask). Use whenever code needs a closed decision about a text plus a " +
  "confidence/probability to threshold on: triage, routing, quality gates, " +
  "publish-or-revise checks.";

export const SKILL_AUTHOR = "Jay Kang (jaykang-heo)";

export const HERMES_TAGS = ["jev", "typesafe", "llm-judge", "triage", "gating"];
export const HERMES_CATEGORY = "ai";

// Hard cap so a future regeneration cannot silently re-inflate the stub with
// CLI-owned instructions. Dashboard, `--help`, and per-command help are the
// source of truth.
export const MAX_SKILL_MARKDOWN_CHARS = 2500;

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render the installable SKILL.md for the jev-axi skill.
 *
 * This is a discovery stub, not a copy of CLI guidance. Installed skills go
 * stale; `jev-axi` (dashboard), `jev-axi --help`, and `jev-axi <command> --help`
 * do not. Keep the body to what jev-axi is, when to reach for it, and pointers
 * at those commands.
 */
export function createSkillMarkdown(): string {
  const markdown = `---
name: jev-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# jev-axi

${DESCRIPTION}

Use jev-axi whenever code needs one closed decision about a text: pick an option
(\`choice\`), get a yes/no probability (\`noul\`), score against a rubric
(\`score\`), or ask up to 32 questions on one request (\`ask\`). Jev returns
numbers, never prose, code, or explanations - a result is evidence to threshold
on, not an authoritative decision.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed
copies go stale. Get the current source of truth from the CLI:

- \`jev-axi\` for a dashboard (key presence, pinned model, examples)
- \`jev-axi --help\` for global flags and the command index
- \`jev-axi <command> --help\` for per-command usage
`;
  if (markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error(
      `generated SKILL.md is ${markdown.length} chars; keep it a stub under ${MAX_SKILL_MARKDOWN_CHARS} and defer guidance to the CLI`,
    );
  }
  return markdown;
}
