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
  renderJson,
  renderSingle,
  SHARED_FLAGS,
  takeSharedFlags,
} from "../question.js";

export const FLAGS = [...SHARED_FLAGS, "--ask"] as const;

export const HELP = `usage: jev-axi noul [flags]
flags[6]:
  --state <file|->, --ask "<statement>", --timeout <s>, --model <id>, --json, --help
Jev answers a yes-or-no question about the state as one number: the noul, a
probability between 0 and 1 that the statement holds. There is no confidence
field - the number itself is the whole answer, and it is NOT on the same scale
as a choice's or score's confidence. It never explains.

options:
  --state <file|->      required; the text judged, read verbatim
  --ask "<statement>"   required; a statement that is true or false of the state
  --timeout <s>         request timeout, default 5, max 30
  --model <id>          default jev-1.13.0 (pinned; the response's model field
                        always reports what actually answered)
  --json                raw vendor JSON instead of TOON

examples:
  jev-axi noul --state diff.txt --ask "The new code handles the empty case correctly"
  cat post.txt | jev-axi noul --state - --ask "This post makes a claim a reviewer would flag as wrong" --json

output:
  noul (0..1), model, latency_ms, tokens. Threshold on it in your own code.
`;

export async function noulCommand(args: string[]): Promise<string> {
  if (takeBoolFlag(args, "--help") || takeBoolFlag(args, "-h")) return HELP;
  const opts = takeSharedFlags(args, "noul");
  const ask = takeRequiredFlag(args, "--ask");
  rejectUnknownFlags(args, FLAGS, "noul");
  rejectPositionals(args, "noul");
  if (ask === undefined)
    throw new AxiError(`--ask is required`, "VALIDATION_ERROR", [
      `jev-axi noul --state <file|-> --ask "<statement that is true or false of the state>"`,
    ]);
  const questions: Record<string, Question> = {
    q: { type: "noul", question: ask },
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
