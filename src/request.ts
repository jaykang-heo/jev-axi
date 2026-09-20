import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { AxiError } from "axi-sdk-js";
import { ENV_KEY } from "./key.js";

export const JEV_BASE = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-1.13.0";
export const DEFAULT_TIMEOUT_S = 5;
export const MAX_TIMEOUT_S = 30;

export type Question = Record<string, unknown> & { type?: string };

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
export type JevAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface JevResult {
  response: JevResponse;
  latencyMs: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function probSumClose(ps: Record<string, number>): boolean {
  const sum = Object.values(ps).reduce((a, b) => a + b, 0);
  return sum >= 0.99 && sum <= 1.01;
}

function sameKeys(a: object, b: object): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Validate one answer against its question; throws BAD_RESPONSE on mismatch. */
function validateAnswer(
  qid: string,
  q: Question,
  a: unknown,
): asserts a is JevAnswer {
  const bad = (why: string) =>
    new AxiError(`question ${qid}: ${why}`, "BAD_RESPONSE");
  if (!isObject(a)) throw bad("answer is not an object");
  const expectedType = q.type;
  if (typeof expectedType !== "string" || expectedType === "")
    throw bad(`question has no type`);
  if (a.type !== expectedType) {
    throw bad(`expected a ${expectedType} answer, got ${JSON.stringify(a.type)}`);
  }
  if (expectedType === "choice") {
    const criteria = q.criteria;
    if (!isObject(criteria)) throw bad("question has no criteria object");
    if (typeof a.choice !== "string" || !(a.choice in criteria))
      throw bad(`choice is not one of the criteria`);
    if (!isObject(a.probabilities) || !sameKeys(a.probabilities, criteria))
      throw bad("probabilities do not cover the criteria");
    for (const [k, p] of Object.entries(a.probabilities))
      if (!isNum(p) || p < 0 || p > 1)
        throw bad(`probability for ${k} is not a number between 0 and 1`);
    if (!probSumClose(a.probabilities as Record<string, number>))
      throw bad("probabilities do not sum to 1");
    if (!isNum(a.confidence) || a.confidence < 0 || a.confidence > 1)
      throw bad("confidence is not a number between 0 and 1");
  } else if (expectedType === "noul") {
    if (!isNum(a.noul) || a.noul < 0 || a.noul > 1)
      throw bad("noul is not a number between 0 and 1");
  } else if (expectedType === "score") {
    const legend = a.legend;
    if (!isObject(legend) || Object.keys(legend).length === 0)
      throw bad("score answer has no legend");
    if (!isNum(a.score) || a.score < -0.01 || a.score > Object.keys(legend).length - 1 + 0.01)
      throw bad("score is outside the legend range");
    if (!isObject(a.probabilities) || !sameKeys(a.probabilities, legend))
      throw bad("probabilities do not cover the legend");
    for (const [k, p] of Object.entries(a.probabilities))
      if (!isNum(p) || p < 0 || p > 1)
        throw bad(`probability for level ${k} is not a number between 0 and 1`);
    if (!probSumClose(a.probabilities as Record<string, number>))
      throw bad("probabilities do not sum to 1");
    if (!isNum(a.confidence) || a.confidence < 0 || a.confidence > 1)
      throw bad("confidence is not a number between 0 and 1");
  } else {
    throw bad(`unknown question type ${JSON.stringify(expectedType)}`);
  }
}

/** Validate a whole vendor response against the questions that produced it. */
export function validateResponse(body: unknown, questions: Record<string, Question>): JevResponse {
  if (!isObject(body)) throw new AxiError("response is not a JSON object", "BAD_RESPONSE");
  if (typeof body.model !== "string" || body.model === "")
    throw new AxiError("response has no model", "BAD_RESPONSE");
  if (!isObject(body.answers)) throw new AxiError("response has no answers object", "BAD_RESPONSE");
  for (const qid of Object.keys(questions)) {
    if (!(qid in body.answers))
      throw new AxiError(`question ${qid}: no answer in response`, "BAD_RESPONSE");
    validateAnswer(qid, questions[qid], body.answers[qid]);
  }
  if (body.usage !== undefined) {
    const u = body.usage;
    if (!isObject(u) || !isNum(u.input_tokens) || !isNum(u.output_tokens))
      throw new AxiError("usage is not {input_tokens, output_tokens}", "BAD_RESPONSE");
  }
  return body as unknown as JevResponse;
}

interface CurlResult {
  code: number;
  status: number;
  headers: string;
  body: string;
  latencyMs: number;
  stderr: string;
}

function excerpt(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function retryAfter(headers: string, body: string): number | undefined {
  const h = headers.match(/^retry-after:\s*(\d+)/im);
  if (h) return Number(h[1]);
  try {
    const b = JSON.parse(body) as Record<string, unknown>;
    if (isNum(b.retry_after)) return b.retry_after;
    const err = b.error;
    if (isObject(err) && isNum(err.retry_after)) return err.retry_after;
  } catch {
    /* body not JSON */
  }
  return undefined;
}

/**
 * POST to /v1/systemone through curl. The bearer token is written to file
 * descriptor 3 and passed as `-H @/dev/fd/3`, so it never appears on argv,
 * in the child environment, in a temp file, or in any output. The request
 * body goes on stdin via `--data-binary @-`; response body and headers are
 * captured to files in a private temp dir.
 */
export async function postSystemOne(opts: {
  key: string;
  model: string;
  state: unknown;
  questions: Record<string, Question>;
  timeoutS: number;
}): Promise<JevResult> {
  const dir = mkdtempSync(join(tmpdir(), "jev-axi-"));
  const bodyPath = join(dir, "body.json");
  const headerPath = join(dir, "headers.txt");
  try {
    const reqBody = JSON.stringify({
      state: opts.state,
      model: opts.model,
      questions: opts.questions,
    });
    const result = await runCurl(opts, reqBody, bodyPath, headerPath);
    if (result.code !== 0) {
      throw new AxiError(
        `request failed after ${Math.round(result.latencyMs)}ms (curl exit ${result.code}): ${excerpt(result.stderr) || "no stderr"}`,
        "TIMEOUT",
        ["check connectivity to api.typesafe.ai", `jev-axi <command> --timeout ${MAX_TIMEOUT_S}`],
      );
    }
    const status = result.status;
    if (status === 200) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        throw new AxiError(
          `HTTP 200 but body is not JSON: ${excerpt(result.body)}`,
          "BAD_RESPONSE",
        );
      }
      const response = validateResponse(parsed, opts.questions);
      return { response, latencyMs: Math.round(result.latencyMs) };
    }
    const detail = excerpt(result.body) || "empty body";
    if (status === 401 || status === 403) {
      throw new AxiError(`HTTP ${status}: ${detail}`, "AUTH", [
        `check ${ENV_HINT}`,
      ]);
    }
    if (status === 400 || status === 404 || status === 422) {
      throw new AxiError(`HTTP ${status}: ${detail}`, "REJECTED", [
        "fix the request per the vendor message",
        "jev-axi <command> --help",
      ]);
    }
    if (status === 429 || status === 529) {
      const ra = retryAfter(result.headers, result.body);
      throw new AxiError(`HTTP ${status}: ${detail}`, "RATE_LIMITED", [
        ra !== undefined ? `retry after ${ra}s` : "retry with backoff",
      ]);
    }
    throw new AxiError(`HTTP ${status}: ${detail}`, "HTTP");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ENV_HINT = "TYPESAFE_API_KEY or ~/.config/jev-axi/env (mode 600)";

function runCurl(
  opts: { key: string; timeoutS: number },
  reqBody: string,
  bodyPath: string,
  headerPath: string,
): Promise<CurlResult> {
  writeFileSync(bodyPath, "");
  writeFileSync(headerPath, "");
  const childEnv = { ...process.env };
  delete childEnv[ENV_KEY];
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(
      "curl",
      [
        "-sS",
        "--max-time",
        String(opts.timeoutS),
        "-D",
        headerPath,
        "-o",
        bodyPath,
        "-w",
        "%{http_code}",
        "-X",
        "POST",
        `${JEV_BASE}/v1/systemone`,
        "-H",
        "Content-Type: application/json",
        "-H",
        "@/dev/fd/3",
        "--data-binary",
        "@-",
      ],
      {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        env: childEnv,
      },
    );
    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.on("error", (err) => {
      reject(
        new AxiError(`could not run curl: ${err.message}`, "VALIDATION_ERROR", [
          "curl must be on PATH",
        ]),
      );
    });
    child.on("close", (code) => {
      const statusText = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      resolve({
        code: code ?? 1,
        status: Number(statusText) || 0,
        headers: existsSafe(headerPath),
        body: existsSafe(bodyPath),
        latencyMs: Date.now() - started,
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });
    const fd3 = child.stdio[3] as Writable | null;
    if (!fd3 || typeof fd3.write !== "function") {
      child.kill();
      reject(new AxiError("curl spawned without a writable fd 3", "BAD_RESPONSE"));
      return;
    }
    fd3.write(`Authorization: Bearer ${opts.key}`);
    fd3.end();
    child.stdin.write(reqBody);
    child.stdin.end();
  });
}

function existsSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
