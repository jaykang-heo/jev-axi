import { AxiError } from "axi-sdk-js";
import {
  rejectPositionals,
  rejectUnknownFlags,
  takeBoolFlag,
  takeRequiredFlag,
} from "../args.js";
import { resolveKey } from "../key.js";
import { postSystemOne } from "../request.js";
import {
  readInput,
  rejectDuplicateStdin,
  renderAsk,
  renderJson,
  SHARED_FLAGS,
  takeSharedFlags,
  validateQuestionsObject,
} from "../question.js";

export const FLAGS = [...SHARED_FLAGS, "--questions-file"] as const;

export const HELP = `usage: jev-axi ask [flags]
flags[6]:
  --state <file|->, --questions-file <json|->, --timeout <s>, --model <id>, --json, --help
Ask several questions about the same state on one request (up to 32, answered
in parallel for almost no extra cost or latency - the question, not the call,
is the unit). The questions object is forwarded to the vendor exactly as
written: each key is a question id, each value a question object with "type":
"choice"|"noul"|"score" plus that type's fields (criteria / question /
rubric). jev-axi checks only that each entry is one of the three types so it
can label the answers; it does not rewrite what you send.

options:
  --state <file|->            required; the text judged, read verbatim
  --questions-file <json|->   required; JSON object {"id": {"type": ..., ...}}
  --timeout <s>               request timeout, default 5, max 30
  --model <id>                default jev-1.13.0 (pinned; the response's model
                              field always reports what actually answered)
  --json                      raw vendor JSON instead of TOON

examples:
  jev-axi ask --state post.txt --questions-file questions.json
  cat diff.txt | jev-axi ask --state - --questions-file qs.json --json

  questions.json:
    {
      "audience": {"type": "choice", "criteria": {"devs": "For developers", "execs": "For executives"}},
      "accurate": {"type": "noul", "question": "Every claim in this text is accurate"},
      "clarity": {"type": "score", "rubric": "1=incoherent ... 9=cristally clear"}
    }

output:
  answers{<id>}: per question id, the same typed fields the single commands
  return; plus model, latency_ms, tokens.
`;

export async function askCommand(args: string[]): Promise<string> {
  if (takeBoolFlag(args, "--help") || takeBoolFlag(args, "-h")) return HELP;
  rejectDuplicateStdin("ask", args, "--state", "--questions-file");
  const opts = takeSharedFlags(args, "ask");
  const fileSpec = takeRequiredFlag(args, "--questions-file");
  rejectUnknownFlags(args, FLAGS, "ask");
  rejectPositionals(args, "ask");
  if (fileSpec === undefined)
    throw new AxiError(`--questions-file is required`, "VALIDATION_ERROR", [
      `jev-axi ask --state <file|-> --questions-file <json|->`,
    ]);
  const raw = readInput(fileSpec, "--questions-file");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AxiError(
      `--questions-file is not valid JSON: ${fileSpec}`,
      "VALIDATION_ERROR",
    );
  }
  const questions = validateQuestionsObject(parsed);
  const key = resolveKey();
  const result = await postSystemOne({
    key,
    model: opts.model,
    state: opts.state,
    questions,
    timeoutS: opts.timeoutS,
  });
  return opts.json ? renderJson(result) : renderAsk(result);
}
