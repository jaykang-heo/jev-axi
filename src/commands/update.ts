import { spawnSync } from "node:child_process";
import { encode } from "@toon-format/toon";
import { AxiError, compareSemver } from "axi-sdk-js";
import { takeBoolFlag } from "../args.js";
import { ENV_KEY } from "../key.js";
import { VERSION } from "../version.js";

const REPO = "jaykang-heo/jev-axi";
const TAG_PREFIX = "jev-axi-v";

export const UPDATE_HELP = `usage: jev-axi update [--check]
jev-axi is private and never published to npm; it installs from GitHub tags.
This command finds the newest ${TAG_PREFIX}* tag on github.com/${REPO}
(via \`gh api\`, falling back to \`git ls-remote\`) and installs it:
  npm install -g github:${REPO}#<tag>

flags[2]:
  --check, --help

examples:
  jev-axi update --check
  jev-axi update
`;

function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[ENV_KEY];
  return env;
}

function listTags(): string[] {
  const gh = spawnSync(
    "gh",
    ["api", `repos/${REPO}/tags`, "--jq", ".[].name"],
    { encoding: "utf-8", env: scrubbedEnv() },
  );
  if (gh.status === 0 && gh.stdout) {
    const names = gh.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    if (names.length > 0) return names;
  }
  const git = spawnSync(
    "git",
    ["ls-remote", "--tags", `git@github.com:${REPO}.git`],
    { encoding: "utf-8", env: scrubbedEnv() },
  );
  if (git.status !== 0 || !git.stdout) return [];
  return git.stdout
    .split("\n")
    .map((l) => l.match(/refs\/tags\/(\S+)$/)?.[1])
    .filter((t): t is string => typeof t === "string" && !t.endsWith("^{}"));
}

function tagVersion(tag: string): string | undefined {
  const m = tag.match(/^jev-axi-v(\d+\.\d+\.\d+(?:-.+)?)$/);
  return m?.[1];
}

function latestTag(): { tag: string; version: string } | undefined {
  let best: { tag: string; version: string } | undefined;
  for (const tag of listTags()) {
    const version = tagVersion(tag);
    if (version === undefined) continue;
    if (!best || compareSemver(version, best.version) > 0)
      best = { tag, version };
  }
  return best;
}

export async function updateCommand(args: string[]): Promise<string> {
  if (takeBoolFlag(args, "--help") || takeBoolFlag(args, "-h"))
    return UPDATE_HELP;
  const check = takeBoolFlag(args, "--check");
  if (args.length > 0)
    throw new AxiError(
      `unknown flag${args.length > 1 ? "s" : ""} for jev-axi update: ${args.join(", ")}`,
      "VALIDATION_ERROR",
      ["jev-axi update [--check]", "jev-axi update --help"],
    );
  const latest = latestTag();
  if (latest === undefined) {
    if (check)
      return encode({
        update: { current: VERSION, latest: "none", status: "no_tags_found" },
      });
    throw new AxiError(
      `no ${TAG_PREFIX}* tag found on github.com/${REPO}`,
      "UPDATE_ERROR",
      [`check access: gh api repos/${REPO}/tags`],
    );
  }
  const status =
    compareSemver(latest.version, VERSION) > 0
      ? "update_available"
      : "up_to_date";
  if (check)
    return encode({
      update: { current: VERSION, latest: latest.tag, status },
    });
  if (status === "up_to_date")
    return encode({
      update: { current: VERSION, latest: latest.tag, status },
    });
  const spec = `github:${REPO}#${latest.tag}`;
  const install = spawnSync("npm", ["install", "-g", spec], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
    env: scrubbedEnv(),
  });
  if (install.status !== 0)
    throw new AxiError(
      `npm install -g ${spec} failed (exit ${install.status ?? "unknown"})`,
      "UPDATE_ERROR",
      [`run it by hand to see npm's error: npm install -g ${spec}`],
    );
  return encode({
    update: {
      status: "updated",
      tag: latest.tag,
      from: VERSION,
      command: `npm install -g ${spec}`,
    },
  });
}
