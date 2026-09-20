import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SENTINEL_KEY = "sk-jev-axi-test-sentinel-7f3a9b2c";

export const DEFAULT_CHOICE_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    q: {
      type: "choice",
      choice: "a",
      probabilities: { a: 0.72, b: 0.21, none: 0.07 },
      confidence: 0.81,
    },
  },
  usage: { input_tokens: 38, output_tokens: 17 },
};

export const DEFAULT_NOUL_RESPONSE = {
  model: "jev-1.13.0",
  answers: { q: { type: "noul", noul: 0.24 } },
  usage: { input_tokens: 21, output_tokens: 6 },
};

export const DEFAULT_SCORE_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    q: {
      type: "score",
      score: 2.4,
      legend: { "0": "unusable", "1": "poor", "2": "ok", "3": "good" },
      probabilities: { "0": 0.05, "1": 0.2, "2": 0.4, "3": 0.35 },
      confidence: 0.77,
    },
  },
  usage: { input_tokens: 30, output_tokens: 22 },
};

export interface FakeCurl {
  /** Directory containing the fake `curl` binary; prepend to PATH. */
  binDir: string;
  /** Directory the fake writes its recordings into. */
  logDir: string;
  read(name: string): string;
  readJson(name: string): unknown;
}

export interface FakeCurlOptions {
  /** HTTP status the fake reports via -w. Default 200. */
  status?: number;
  /** JSON body written to the -o target. */
  response?: unknown;
  /** Raw body written to the -o target (overrides response). */
  rawBody?: string;
  /** Response headers written to the -D target. */
  headers?: string;
  /** If set, the fake exits with this code instead of serving a response. */
  exitCode?: number;
  /** Stderr text the fake emits. */
  stderr?: string;
}

/**
 * Install a fake `curl` that records argv, child env hygiene, the request body
 * (stdin), and the auth header (fd 3) into logDir, then serves the canned
 * response exactly like the real invocation pattern:
 *   curl -sS --max-time T -D hdrs -o body -w %{http_code} -X POST <url>
 *        -H 'Content-Type: application/json' -H @/dev/fd/3 --data-binary @-
 */
export function installFakeCurl(opts: FakeCurlOptions = {}): FakeCurl {
  const dir = mkdtempSync(join(tmpdir(), "jev-axi-fake-curl-"));
  const binDir = join(dir, "bin");
  const logDir = join(dir, "log");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  writeFileSync(
    join(dir, "response.json"),
    opts.rawBody ?? JSON.stringify(opts.response ?? DEFAULT_CHOICE_RESPONSE),
  );
  writeFileSync(join(dir, "http-status"), String(opts.status ?? 200));
  writeFileSync(join(dir, "exit-code"), String(opts.exitCode ?? 0));
  writeFileSync(
    join(dir, "headers.txt"),
    opts.headers ?? "HTTP/2 200\r\ncontent-type: application/json\r\n",
  );
  writeFileSync(join(dir, "stderr.txt"), opts.stderr ?? "");

  const script = `#!/usr/bin/env bash
set -u
LOG="${logDir}"
DIR="${dir}"
SENTINEL="${SENTINEL_KEY}"

: > "$LOG/argv"
out=""
hdrs=""
prev=""
for a in "$@"; do
  printf '%s\\n' "$a" >> "$LOG/argv"
  case "$prev" in
    -o) out="$a" ;;
    -D) hdrs="$a" ;;
  esac
  prev="$a"
done

# env hygiene: the key must not be visible to the child, by name or by value
if env | cut -d= -f1 | grep -q '^TYPESAFE_API_KEY$'; then
  echo dirty > "$LOG/env-typescope"
else
  echo clean > "$LOG/env-typescope"
fi
if env | grep -qF "$SENTINEL"; then
  echo dirty > "$LOG/env-sentinel"
else
  echo clean > "$LOG/env-sentinel"
fi

cat > "$LOG/body"

if cat /dev/fd/3 > "$LOG/fd3" 2>/dev/null; then
  :
else
  echo unreadable > "$LOG/fd3"
fi

cat "$DIR/stderr.txt" >&2
code="$(cat "$DIR/exit-code")"
if [ "$code" != "0" ]; then
  cat "$DIR/http-status"
  exit "$code"
fi

[ -n "$hdrs" ] && cp "$DIR/headers.txt" "$hdrs"
[ -n "$out" ] && cp "$DIR/response.json" "$out"
cat "$DIR/http-status"
`;

  const bin = join(binDir, "curl");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);

  return {
    binDir,
    logDir,
    read: (name) => readFileSync(join(logDir, name), "utf-8"),
    readJson: (name) => JSON.parse(readFileSync(join(logDir, name), "utf-8")),
  };
}

/** Prepend fake's binDir to PATH (and restore later via the returned fn). */
export function withPathPrepended(dir: string): () => void {
  const orig = process.env.PATH;
  process.env.PATH = `${dir}:${orig}`;
  return () => {
    process.env.PATH = orig;
  };
}
