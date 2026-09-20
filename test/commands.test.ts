import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICE_RESPONSE,
  DEFAULT_NOUL_RESPONSE,
  DEFAULT_SCORE_RESPONSE,
  installFakeCurl,
  SENTINEL_KEY,
  withPathPrepended,
  type FakeCurl,
} from "./helpers/fake-curl.js";
import { run, tmpdir_, withEnv, writeTmp } from "./helpers/run.js";

let dir: string;
let home: string;
let state: string;
let restorePath: (() => void) | undefined;
let fake: FakeCurl;

beforeEach(() => {
  dir = tmpdir_();
  home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  state = writeTmp(dir, "state.txt", "The deploy failed right after the migration ran.");
});

afterEach(() => {
  restorePath?.();
  restorePath = undefined;
});

function useFake(opts: Parameters<typeof installFakeCurl>[0] = {}): FakeCurl {
  fake = installFakeCurl(opts);
  restorePath = withPathPrepended(fake.binDir);
  return fake;
}

const keyed = <T>(fn: () => Promise<T>) =>
  withEnv({ TYPESAFE_API_KEY: SENTINEL_KEY, HOME: home }, fn);

function requestBody(): { state: unknown; model: string; questions: Record<string, any> } {
  return fake.readJson("body") as any;
}

describe("choice", () => {
  it("builds the vendor request body and renders the typed answer", async () => {
    useFake({ response: DEFAULT_CHOICE_RESPONSE });
    const r = await keyed(() =>
      run([
        "choice", "--state", state,
        "--option", "a=Rollback the migration",
        "--option", "b=Fix forward",
        "--none",
      ]),
    );
    expect(r.exit).toBe(0);
    const body = requestBody();
    expect(body.model).toBe("jev-1.13.0");
    expect(body.state).toBe("The deploy failed right after the migration ran.");
    expect(body.questions).toEqual({
      q: {
        type: "choice",
        criteria: {
          a: "Rollback the migration",
          b: "Fix forward",
          none: "Neither of the above / none apply",
        },
      },
    });
    expect(r.stdout).toContain('"jev-axi":');
    expect(r.stdout).toContain("question: q");
    expect(r.stdout).toContain("choice: a");
    expect(r.stdout).toContain("confidence: 0.81");
    expect(r.stdout).toContain("winning_probability: 0.72");
    expect(r.stdout).toContain("model: jev-1.13.0");
    expect(r.stdout).toContain("tokens: 55");
    expect(r.stdout).toContain("help[1]:");
  });

  it("--none appends the neutral option", async () => {
    useFake();
    await keyed(() =>
      run(["choice", "--state", state, "--option", "a=X", "--option", "b=Y", "--none"]),
    );
    const criteria = requestBody().questions.q.criteria;
    expect(Object.keys(criteria)).toEqual(["a", "b", "none"]);
    expect(criteria.none).toBe("Neither of the above / none apply");
  });

  it("--option and --options-file produce equivalent requests", async () => {
    useFake();
    const optsFile = writeTmp(dir, "options.json", JSON.stringify({ a: "X", b: "Y" }));
    await keyed(() =>
      run(["choice", "--state", state, "--option", "a=X", "--option", "b=Y"]),
    );
    const viaFlags = requestBody();
    await keyed(() =>
      run(["choice", "--state", state, "--options-file", optsFile]),
    );
    expect(requestBody()).toEqual(viaFlags);
  });

  it("accepts a JSON state as structured state", async () => {
    useFake();
    const jstate = writeTmp(dir, "state.json", JSON.stringify({ ticket: "deploy broke", sev: 2 }));
    await keyed(() =>
      run(["choice", "--state", jstate, "--option", "a=X", "--option", "b=Y"]),
    );
    expect(requestBody().state).toEqual({ ticket: "deploy broke", sev: 2 });
  });

  it("rejects --option without name=criterion form", async () => {
    useFake();
    const r = await keyed(() =>
      run(["choice", "--state", state, "--option", "justtext"]),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("must be name=");
    expect(r.stdout).toContain("VALIDATION_ERROR");
  });
});

describe("noul", () => {
  it("sends the statement and renders the noul", async () => {
    useFake({ response: DEFAULT_NOUL_RESPONSE });
    const r = await keyed(() =>
      run(["noul", "--state", state, "--ask", "The migration caused the failure"]),
    );
    expect(r.exit).toBe(0);
    expect(requestBody().questions).toEqual({
      q: { type: "noul", question: "The migration caused the failure" },
    });
    expect(r.stdout).toContain("noul: 0.24");
    expect(r.stdout).toContain("model: jev-1.13.0");
  });

  it("requires --ask", async () => {
    useFake();
    const r = await keyed(() => run(["noul", "--state", state]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("--ask is required");
  });
});

describe("score", () => {
  it("sends the rubric verbatim and renders the score answer", async () => {
    useFake({ response: DEFAULT_SCORE_RESPONSE });
    const rubric = writeTmp(dir, "rubric.txt", "0=unusable 1=poor 2=ok 3=good");
    const r = await keyed(() =>
      run(["score", "--state", state, "--rubric", rubric]),
    );
    expect(r.exit).toBe(0);
    expect(requestBody().questions).toEqual({
      q: { type: "score", rubric: "0=unusable 1=poor 2=ok 3=good" },
    });
    expect(r.stdout).toContain("score: 2.4");
    expect(r.stdout).toContain("confidence: 0.77");
    expect(r.stdout).toContain("winning_probability: 0.4");
  });

  it("requires --rubric", async () => {
    useFake();
    const r = await keyed(() => run(["score", "--state", state]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("--rubric is required");
  });
});

describe("ask", () => {
  it("forwards the questions object exactly as written", async () => {
    const questions = {
      z_last: { type: "choice", criteria: { one: "First", two: "Second" } },
      a_first: { type: "noul", question: "Is it Tuesday?" },
      mid: { type: "score", rubric: "rate 0-3", extra_field: { nested: [1, 2] } },
    };
    const qfile = writeTmp(dir, "qs.json", JSON.stringify(questions));
    const response = {
      model: "jev-1.13.0",
      answers: {
        z_last: {
          type: "choice",
          choice: "two",
          probabilities: { one: 0.3, two: 0.7 },
          confidence: 0.66,
        },
        a_first: { type: "noul", noul: 0.5 },
        mid: {
          type: "score",
          score: 0.9,
          legend: { "0": "lo", "1": "hi" },
          probabilities: { "0": 0.4, "1": 0.6 },
          confidence: 0.9,
        },
      },
      usage: { input_tokens: 50, output_tokens: 40 },
    };
    useFake({ response });
    const r = await keyed(() =>
      run(["ask", "--state", state, "--questions-file", qfile]),
    );
    expect(r.exit).toBe(0);
    // byte-for-byte up to JSON semantics: same object, same key order, extras intact
    const sent = requestBody().questions;
    expect(JSON.stringify(sent)).toBe(JSON.stringify(questions));
    expect(r.stdout).toContain("z_last:");
    expect(r.stdout).toContain("choice: two");
    expect(r.stdout).toContain("a_first:");
    expect(r.stdout).toContain("noul: 0.5");
    expect(r.stdout).toContain("mid:");
    expect(r.stdout).toContain("score: 0.9");
  });

  it("rejects malformed JSON and non-question objects", async () => {
    useFake();
    const bad = writeTmp(dir, "bad.json", "{not json");
    let r = await keyed(() => run(["ask", "--state", state, "--questions-file", bad]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("not valid JSON");

    const arr = writeTmp(dir, "arr.json", "[1,2]");
    r = await keyed(() => run(["ask", "--state", state, "--questions-file", arr]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("object mapping question ids");

    const badType = writeTmp(dir, "bt.json", JSON.stringify({ q: { type: "essay" } }));
    r = await keyed(() => run(["ask", "--state", state, "--questions-file", badType]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("type must be");
  });
});

describe("shared flags", () => {
  it("--json returns the raw vendor response", async () => {
    useFake({ response: DEFAULT_NOUL_RESPONSE });
    const r = await keyed(() =>
      run(["noul", "--state", state, "--ask", "x", "--json"]),
    );
    expect(r.exit).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.answers.q.noul).toBe(0.24);
    expect(parsed.model).toBe("jev-1.13.0");
    expect(parsed.latency_ms).toBeTypeOf("number");
  });

  it("--model overrides the pinned default", async () => {
    useFake();
    await keyed(() =>
      run(["noul", "--state", state, "--ask", "x", "--model", "jev-9.9.9"]),
    );
    expect(requestBody().model).toBe("jev-9.9.9");
  });

  it("--timeout bounds and rejects out-of-range values", async () => {
    useFake({ response: DEFAULT_NOUL_RESPONSE });
    let r = await keyed(() =>
      run(["noul", "--state", state, "--ask", "x", "--timeout", "12"]),
    );
    expect(r.exit).toBe(0);
    expect(fake.read("argv")).toContain("--max-time\n12");

    r = await keyed(() =>
      run(["noul", "--state", state, "--ask", "x", "--timeout", "99"]),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("--timeout");
  });
});

describe("validation failures (exit 2)", () => {
  it("unknown command", async () => {
    const r = await keyed(() => run(["bogus"]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("Unknown command");
    expect(r.stdout).toContain("VALIDATION_ERROR");
  });

  it("unknown flag", async () => {
    const r = await keyed(() =>
      run(["choice", "--state", state, "--option", "a=X", "--bogus"]),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("unknown flag");
    expect(r.stdout).toContain("--bogus");
  });

  it("missing --state", async () => {
    const r = await keyed(() => run(["noul", "--ask", "x"]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("--state is required");
  });

  it("unreadable state file", async () => {
    const r = await keyed(() =>
      run(["choice", "--state", join(dir, "nope.txt"), "--option", "a=X"]),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("not readable");
  });

  it("no options given", async () => {
    const r = await keyed(() => run(["choice", "--state", state]));
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("at least one option");
  });

  it("stdin can only supply one input", async () => {
    const r = await keyed(() =>
      run(["score", "--state", "-", "--rubric", "-"]),
    );
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("stdin (-) can only supply one");
  });
});

describe("request failures (exit 1)", () => {
  it("HTTP 401 -> AUTH", async () => {
    useFake({ status: 401, rawBody: '{"error":"invalid key"}', headers: "HTTP/2 401\r\n" });
    const r = await keyed(() =>
      run(["noul", "--state", state, "--ask", "x"]),
    );
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("code: AUTH");
    expect(r.stdout).toContain("401");
  });

  it("HTTP 400 -> REJECTED", async () => {
    useFake({ status: 400, rawBody: '{"error":"bad questions"}' });
    const r = await keyed(() => run(["noul", "--state", state, "--ask", "x"]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("code: REJECTED");
  });

  it("HTTP 429 -> RATE_LIMITED with retry hint", async () => {
    useFake({
      status: 429,
      rawBody: '{"error":"slow down"}',
      headers: "HTTP/2 429\r\nretry-after: 7\r\n",
    });
    const r = await keyed(() => run(["noul", "--state", state, "--ask", "x"]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("code: RATE_LIMITED");
    expect(r.stdout).toContain("retry after 7s");
  });

  it("HTTP 500 -> HTTP", async () => {
    useFake({ status: 500, rawBody: "boom" });
    const r = await keyed(() => run(["noul", "--state", state, "--ask", "x"]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("code: HTTP");
    expect(r.stdout).toContain("500");
  });

  it("curl failure -> TIMEOUT", async () => {
    useFake({ exitCode: 28, stderr: "curl: (28) Operation timed out" });
    const r = await keyed(() => run(["noul", "--state", state, "--ask", "x"]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("code: TIMEOUT");
  });

  it("HTTP 200 with non-JSON body -> BAD_RESPONSE", async () => {
    useFake({ rawBody: "<html>not json</html>" });
    const r = await keyed(() => run(["noul", "--state", state, "--ask", "x"]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("code: BAD_RESPONSE");
  });
});

describe("response validation (BAD_RESPONSE, exit 1)", () => {
  const cases: [string, unknown][] = [
    ["missing answers", { model: "jev-1.13.0" }],
    ["wrong answer type", { model: "jev-1.13.0", answers: { q: { type: "noul", noul: 0.5 } } }],
    ["choice not in criteria", { model: "m", answers: { q: { type: "choice", choice: "z", probabilities: { a: 0.5, b: 0.5 }, confidence: 0.9 } } }],
    ["probabilities missing a criterion", { model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 1 }, confidence: 0.9 } } }],
    ["probabilities do not sum to 1", { model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.3, b: 0.3 }, confidence: 0.9 } } }],
    ["confidence out of range", { model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 }, confidence: 1.7 } } }],
    ["missing model", { answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 }, confidence: 0.9 } } }],
  ];
  for (const [name, response] of cases) {
    it(name, async () => {
      useFake({ response });
      const r = await keyed(() =>
        run(["choice", "--state", state, "--option", "a=X", "--option", "b=Y"]),
      );
      expect(r.exit).toBe(1);
      expect(r.stdout).toContain("code: BAD_RESPONSE");
    });
  }

  it("noul out of range", async () => {
    useFake({ response: { model: "m", answers: { q: { type: "noul", noul: 1.4 } } } });
    const r = await keyed(() => run(["noul", "--state", state, "--ask", "x"]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("BAD_RESPONSE");
  });

  it("score probabilities must cover the legend", async () => {
    useFake({
      response: {
        model: "m",
        answers: {
          q: {
            type: "score",
            score: 1,
            legend: { "0": "lo", "1": "hi" },
            probabilities: { "0": 1 },
            confidence: 0.9,
          },
        },
      },
    });
    const r = await keyed(() => run(["score", "--state", state, "--rubric", state]));
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain("probabilities do not cover the legend");
  });
});
