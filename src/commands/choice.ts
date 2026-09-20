import { AxiError } from "axi-sdk-js";
import {
  rejectPositionals,
  rejectUnknownFlags,
  takeAllFlags,
  takeBoolFlag,
  takeRequiredFlag,
} from "../args.js";
import { resolveKey } from "../key.js";
import {
  postSystemOne,
  type Question,
} from "../request.js";
import {
  readInput,
  rejectDuplicateStdin,
  renderJson,
  renderSingle,
  SHARED_FLAGS,
  takeSharedFlags,
} from "../question.js";

export const FLAGS = [
  ...SHARED_FLAGS,
  "--option",
  "--options-file",
  "--none",
] as const;

export const HELP = `usage: jev-axi choice [flags]
flags[8]:
  --state <file|->, --option name="<criterion>", --options-file <json|->, --none, --timeout <s>, --model <id>, --json, --help
Jev picks exactly one option from the closed set and answers with it, a
probability per option, and a confidence. It never explains, never writes
prose, and never invents an option you did not offer.

options:
  --state <file|->        required; the text judged, read verbatim
  --option name="<crit>"  one option per flag; name is the label Jev answers
                          with, <crit> is the criterion it weighs
  --options-file <j|->    same options as a JSON object {"name": "criterion"};
                          interchangeable with --option
  --none                  append option "none" = "Neither of the above / none
                          apply", so Jev can decline instead of forcing a pick
  --timeout <s>           request timeout, default 5, max 30
  --model <id>            default jev-1.13.0 (pinned; the response's model
                          field always reports what actually answered)
  --json                  raw vendor JSON instead of TOON

examples:
  jev-axi choice --state bug.txt --option code="The fault is in application code" --option env="The fault is in the environment" --option spec="The report does not describe a fault" --none
  cat email.txt | jev-axi choice --state - --options-file options.json
  jev-axi choice --state email.txt --option reply="Needs a reply" --option fyi="No reply needed" --json

output:
  choice (the winning option name), confidence, winning_probability (that
  option's probability - the floor to threshold on), probabilities per option,
  model, latency_ms, tokens.
`;

function collectCriteria(args: string[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  const add = (name: string, criterion: unknown, source: string) => {
    if (name === "")
      throw new AxiError(`${source}: option name may not be empty`, "VALIDATION_ERROR");
    if (name in criteria)
      throw new AxiError(
        `option ${JSON.stringify(name)} is defined twice`,
        "VALIDATION_ERROR",
      );
    if (typeof criterion !== "string" || criterion === "")
      throw new AxiError(
        `option ${JSON.stringify(name)}: criterion must be a non-empty string`,
        "VALIDATION_ERROR",
      );
    criteria[name] = criterion;
  };
  for (const opt of takeAllFlags(args, "--option")) {
    const eq = opt.indexOf("=");
    if (eq === -1)
      throw new AxiError(
        `--option must be name="<criterion>", got ${JSON.stringify(opt)}`,
        "VALIDATION_ERROR",
        [`jev-axi choice --option post="Publish it" --option revise="Revise first"`],
      );
    add(opt.slice(0, eq), opt.slice(eq + 1), "--option");
  }
  const fileSpec = takeRequiredFlag(args, "--options-file");
  if (fileSpec !== undefined) {
    const raw = readInput(fileSpec, "--options-file");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AxiError(
        `--options-file is not valid JSON: ${fileSpec}`,
        "VALIDATION_ERROR",
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new AxiError(
        `--options-file must contain a JSON object {"name": "criterion"}`,
        "VALIDATION_ERROR",
      );
    for (const [k, v] of Object.entries(parsed)) add(k, v, "--options-file");
  }
  if (takeBoolFlag(args, "--none")) {
    add("none", "Neither of the above / none apply", "--none");
  }
  return criteria;
}

export async function choiceCommand(args: string[]): Promise<string> {
  if (takeBoolFlag(args, "--help") || takeBoolFlag(args, "-h")) return HELP;
  rejectDuplicateStdin("choice", args, "--state", "--options-file");
  const opts = takeSharedFlags(args, "choice");
  const criteria = collectCriteria(args);
  rejectUnknownFlags(args, FLAGS, "choice");
  rejectPositionals(args, "choice");
  if (Object.keys(criteria).length === 0)
    throw new AxiError(`choice needs at least one option`, "VALIDATION_ERROR", [
      `jev-axi choice --state <file> --option a="<criterion>" --option b="<criterion>"`,
      `jev-axi choice --state <file> --options-file options.json`,
    ]);
  const questions: Record<string, Question> = {
    q: { type: "choice", criteria },
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
