import { AxiError } from "axi-sdk-js";
import {
  rejectPositionals,
  rejectUnknownFlags,
  takeBoolFlag,
  takeRequiredFlag,
} from "../args.js";
import { resolveKey } from "../key.js";
import { postSystemOne, type Question } from "../request.js";
import {
  readInput,
  rejectDuplicateStdin,
  renderJson,
  renderSingle,
  SHARED_FLAGS,
  takeSharedFlags,
} from "../question.js";

export const FLAGS = [...SHARED_FLAGS, "--rubric"] as const;

export const HELP = `usage: jev-axi score [flags]
flags[6]:
  --state <file|->, --rubric <file|->, --timeout <s>, --model <id>, --json, --help
Jev rates the state against a rubric on the vendor's fixed 0-9 scale and
answers with a probability-weighted score, a probability per level, and a
confidence. It never explains the score.

options:
  --state <file|->    required; the text judged, read verbatim
  --rubric <file|->   required; the rubric text, read verbatim; "-" reads stdin
  --timeout <s>       request timeout, default 5, max 30
  --model <id>        default jev-1.13.0 (pinned; the response's model field
                      always reports what actually answered)
  --json              raw vendor JSON instead of TOON

examples:
  jev-axi score --state post.txt --rubric publishability.txt
  cat draft.md | jev-axi score --state - --rubric rubric.txt --json

output:
  score (weighted, can land between levels), legend, probabilities per level,
  confidence, winning_probability (top level's probability), model,
  latency_ms, tokens.
`;

export async function scoreCommand(args: string[]): Promise<string> {
  if (takeBoolFlag(args, "--help") || takeBoolFlag(args, "-h")) return HELP;
  rejectDuplicateStdin("score", args, "--state", "--rubric");
  const opts = takeSharedFlags(args, "score");
  const rubricSpec = takeRequiredFlag(args, "--rubric");
  rejectUnknownFlags(args, FLAGS, "score");
  rejectPositionals(args, "score");
  if (rubricSpec === undefined)
    throw new AxiError(`--rubric is required`, "VALIDATION_ERROR", [
      `jev-axi score --state <file|-> --rubric <file|->`,
    ]);
  const rubric = readInput(rubricSpec, "--rubric");
  const questions: Record<string, Question> = {
    q: { type: "score", rubric },
  };
  const key = resolveKey();
  const result = await postSystemOne({
    key,
    model: opts.model,
    state: opts.state,
    questions,
    timeoutS: opts.timeoutS,
  });
  return opts.json ? renderJson(result) : renderSingle("q", result);
}
