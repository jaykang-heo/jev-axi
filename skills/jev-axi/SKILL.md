---
name: jev-axi
description: "Ask TypeSafe's Jev for a typed judgment about a text through the jev-axi CLI - pick one option from a closed set (choice), get a yes/no probability (noul), or rate a text against a rubric (score), several questions in parallel on one call (ask). Use whenever code needs a closed decision about a text plus a confidence/probability to threshold on: triage, routing, quality gates, publish-or-revise checks."
user-invocable: false
author: Jay Kang (jaykang-heo)
metadata:
  hermes:
    tags: [jev, typesafe, llm-judge, triage, gating]
    category: ai
---

# jev-axi

Typed judgments about a text from typesafe.ai's Jev: pick one option from a set, a yes/no probability, or a score against a rubric, in under a second. Numbers only, never prose, never a decision. Use it when your code needs one closed decision about a text and a confidence to threshold on.

Use jev-axi whenever code needs one closed decision about a text: pick an option
(`choice`), get a yes/no probability (`noul`), score against a rubric
(`score`), or ask up to 32 questions on one request (`ask`). Jev returns
numbers, never prose, code, or explanations - a result is evidence to threshold
on, not an authoritative decision.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed
copies go stale. Get the current source of truth from the CLI:

- `jev-axi` for a dashboard (key presence, pinned model, examples)
- `jev-axi --help` for global flags and the command index
- `jev-axi <command> --help` for per-command usage
