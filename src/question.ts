import { readFileSync } from "node:fs";
import { encode } from "@toon-format/toon";
import { AxiError } from "axi-sdk-js";
import {
  flagValueOf,
  takeBoolFlag,
  takeFlag,
  takeRequiredFlag,
} from "./args.js";
import {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_S,
  MAX_TIMEOUT_S,
  type JevAnswer,
  type JevResult,
  type Question,
} from "./request.js";
import { renderHelp } from "./toon.js";

export interface SharedOpts {
  state: unknown;
  model: string;
  timeoutS: number;
  json: boolean;
}

export const SHARED_FLAGS = [
  "--state",
  "--timeout",
  "--model",
  "--json",
  "--help",
  "-h",
] as const;

export function readInput(spec: string, flag: string): string {
  if (spec === "-") {
    if (process.stdin.isTTY)
      throw new AxiError(
        `${flag} - reads stdin but stdin is a terminal; pipe input in`,
        "VALIDATION_ERROR",
        [`cat file.txt | jev-axi <command> ${flag} -`],
      );
    return readFileSync(0, "utf-8");
  }
  try {
    return readFileSync(spec, "utf-8");
  } catch {
    throw new AxiError(`${flag} file not readable: ${spec}`, "VALIDATION_ERROR", [
      `check the path; use ${flag} - to read stdin`,
    ]);
  }
}

function parseState(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Stdin can supply only one input. Call before any flag consumption when a
 * command accepts more than one file flag that supports "-".
 */
export function rejectDuplicateStdin(command: string, args: string[], ...flags: string[]): void {
  const fromStdin = flags.filter((f) => flagValueOf(args, f) === "-");
  if (fromStdin.length > 1)
    throw new AxiError(
      `stdin (-) can only supply one of ${fromStdin.join(", ")}`,
      "VALIDATION_ERROR",
    );
}

/** Parse the flags every question command shares; removes them from args. */
export function takeSharedFlags(args: string[], command: string): SharedOpts {
  const stateSpec = takeRequiredFlag(args, "--state");
  if (stateSpec === undefined)
    throw new AxiError(`--state is required`, "VALIDATION_ERROR", [
      `jev-axi ${command} --state <file|-> ...`,
      `jev-axi ${command} --help`,
    ]);
  const timeoutRaw = takeFlag(args, "--timeout");
  let timeoutS = DEFAULT_TIMEOUT_S;
  if (timeoutRaw !== undefined) {
    timeoutS = Number.parseFloat(timeoutRaw);
    if (!Number.isFinite(timeoutS) || timeoutS <= 0 || timeoutS > MAX_TIMEOUT_S)
      throw new AxiError(
        `--timeout must be a number between 0 and ${MAX_TIMEOUT_S} seconds, got ${JSON.stringify(timeoutRaw)}`,
        "VALIDATION_ERROR",
      );
  }
  const model = takeFlag(args, "--model") ?? DEFAULT_MODEL;
  if (model.trim() === "")
    throw new AxiError(`--model requires a model id`, "VALIDATION_ERROR");
  const json = takeBoolFlag(args, "--json");
  return {
    state: parseState(readInput(stateSpec, "--state")),
    model,
    timeoutS,
    json,
  };
}

/**
 * Validate a caller-supplied questions object for `ask`. Questions are
 * forwarded to the vendor byte-for-byte; we check only what lets us label the
 * answers — each entry must be an object with a non-empty string `type` of
 * choice|noul|score.
 */
export function validateQuestionsObject(
  raw: unknown,
): Record<string, Question> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new AxiError(
      `--questions-file must contain a JSON object mapping question ids to question objects`,
      "VALIDATION_ERROR",
    );
  const entries = Object.entries(raw);
  if (entries.length === 0)
    throw new AxiError(`--questions-file is an empty object`, "VALIDATION_ERROR");
  if (entries.length > 32)
    throw new AxiError(
      `--questions-file has ${entries.length} questions; Jev answers at most 32 per call`,
      "VALIDATION_ERROR",
    );
  for (const [qid, q] of entries) {
    if (typeof q !== "object" || q === null || Array.isArray(q))
      throw new AxiError(`question ${qid}: not an object`, "VALIDATION_ERROR");
    const t = (q as Question).type;
    if (t !== "choice" && t !== "noul" && t !== "score")
      throw new AxiError(
        `question ${qid}: type must be "choice", "noul", or "score", got ${JSON.stringify(t)}`,
        "VALIDATION_ERROR",
      );
  }
  return raw as Record<string, Question>;
}

const THRESHOLD_HINT =
  "Threshold on confidence AND winning_probability in your own code; a noul's number is not on the same scale as a choice's confidence";

function sortedProbs(
  ps: Record<string, number>,
  label: string,
): { [k: string]: string | number }[] {
  return Object.entries(ps)
    .sort((a, b) => b[1] - a[1])
    .map(([k, p]) => ({ [label]: k, p }));
}

/** Flat, greppable fields for one typed answer. */
export function answerFields(a: JevAnswer): Record<string, unknown> {
  switch (a.type) {
    case "choice":
      return {
        type: "choice",
        choice: a.choice,
        confidence: a.confidence,
        winning_probability: a.probabilities[a.choice],
        probabilities: sortedProbs(a.probabilities, "option"),
      };
    case "noul":
      return { type: "noul", noul: a.noul };
    case "score": {
      const best = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0];
      return {
        type: "score",
        score: a.score,
        legend: a.legend,
        probabilities: sortedProbs(a.probabilities, "level"),
        confidence: a.confidence,
        winning_probability: best ? best[1] : undefined,
      };
    }
  }
}

function usageTokens(r: JevResult): number | undefined {
  const u = r.response.usage;
  return u ? u.input_tokens + u.output_tokens : undefined;
}

/** Single-question result block: {"jev-axi": {question, <answer fields>, model, ...}}. */
export function renderSingle(
  qid: string,
  r: JevResult,
): string {
  const inner: Record<string, unknown> = {
    question: qid,
    ...answerFields(r.response.answers[qid]),
    model: r.response.model,
    latency_ms: r.latencyMs,
  };
  const tokens = usageTokens(r);
  if (tokens !== undefined) inner.tokens = tokens;
  return renderOutputWithHint(encode({ "jev-axi": inner }));
}

/** Multi-question result block: {"jev-axi": {answers: {id: {...}}, model, ...}}. */
export function renderAsk(r: JevResult): string {
  const answers: Record<string, unknown> = {};
  for (const [qid, a] of Object.entries(r.response.answers)) {
    answers[qid] = answerFields(a);
  }
  const inner: Record<string, unknown> = {
    answers,
    model: r.response.model,
    latency_ms: r.latencyMs,
  };
  const tokens = usageTokens(r);
  if (tokens !== undefined) inner.tokens = tokens;
  return renderOutputWithHint(encode({ "jev-axi": inner }));
}

function renderOutputWithHint(block: string): string {
  return `${block}\n${renderHelp([THRESHOLD_HINT])}`;
}

/** --json: the raw vendor response plus latency, exactly as received. */
export function renderJson(r: JevResult): string {
  return JSON.stringify({ ...r.response, latency_ms: r.latencyMs }, null, 2);
}
