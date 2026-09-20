import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { run, tmpdir_, withEnv } from "./helpers/run.js";

let restorePath: (() => void) | undefined;
afterEach(() => {
  restorePath?.();
  restorePath = undefined;
});

/** Fake `gh`, `git`, and `npm` binaries logging to dir/log. */
function installFakeTools(opts: { tags?: string[] } = {}) {
  const dir = tmpdir_("jev-axi-fake-tools-");
  const bin = join(dir, "bin");
  const log = join(dir, "log");
  mkdirSync(bin, { recursive: true });
  mkdirSync(log, { recursive: true });
  const tags = (opts.tags ?? []).join("\n");

  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${log}/gh-argv"
printf '%s\\n' "${tags}"
`);
  writeFileSync(join(bin, "git"), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${log}/git-argv"
# ls-remote --tags format: <sha>\\trefs/tags/<name>
${(opts.tags ?? []).map((t) => `printf 'deadbeef\\trefs/tags/${t}\\n'`).join("\n")}
`);
  writeFileSync(join(bin, "npm"), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${log}/npm-argv"
`);
  for (const b of ["gh", "git", "npm"]) chmodSync(join(bin, b), 0o755);
  const orig = process.env.PATH;
  process.env.PATH = `${bin}:${orig}`;
  restorePath = () => {
    process.env.PATH = orig;
  };
  return { log };
}

describe("update (private GitHub-tag install)", () => {
  it("--check reports update_available against the newest jev-axi-v* tag", async () => {
    const { log } = installFakeTools({ tags: ["jev-axi-v0.1.0", "jev-axi-v9.9.9", "other-v1.0.0"] });
    const r = await run(["update", "--check"]);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain(`current: ${VERSION}`);
    expect(r.stdout).toContain("latest: jev-axi-v9.9.9");
    expect(r.stdout).toContain("status: update_available");
    // gh api was the primary path
    expect(readFileSync(join(log, "gh-argv"), "utf-8")).toContain("repos/jaykang-heo/jev-axi/tags");
  });

  it("--check reports up_to_date when no tag is newer", async () => {
    installFakeTools({ tags: [`jev-axi-v${VERSION}`] });
    const r = await run(["update", "--check"]);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("status: up_to_date");
  });

  it("falls back to git ls-remote when gh fails", async () => {
    const dir = tmpdir_("jev-axi-fake-tools-");
    const bin = join(dir, "bin");
    const log = join(dir, "log");
    mkdirSync(bin, { recursive: true });
    mkdirSync(log, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 1\n");
    writeFileSync(
      join(bin, "git"),
      `#!/usr/bin/env bash\nprintf 'deadbeef\\trefs/tags/jev-axi-v8.8.8\\n'\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    chmodSync(join(bin, "git"), 0o755);
    const orig = process.env.PATH;
    process.env.PATH = `${bin}:${orig}`;
    restorePath = () => {
      process.env.PATH = orig;
    };
    const r = await run(["update", "--check"]);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("latest: jev-axi-v8.8.8");
  });

  it("installs via npm install -g github:...#tag, never the registry", async () => {
    const { log } = installFakeTools({ tags: ["jev-axi-v9.9.9"] });
    const r = await run(["update"]);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("status: updated");
    const npmArgv = readFileSync(join(log, "npm-argv"), "utf-8");
    expect(npmArgv).toContain("install\n-g\ngithub:jaykang-heo/jev-axi#jev-axi-v9.9.9");
  });

  it("never queries an npm registry path", async () => {
    const { log } = installFakeTools({ tags: [`jev-axi-v${VERSION}`] });
    await run(["update", "--check"]);
    expect(existsSync(join(log, "npm-argv"))).toBe(false);
  });
});

describe("setup hooks", () => {
  it("reports the installed block", async () => {
    // The SDK only writes hooks when argv[1] resolves to a real installed
    // entrypoint (dist/bin/jev-axi.js); under vitest that gate no-ops by
    // design, so the filesystem assertion lives in compiled.test.ts.
    const home = tmpdir_("jev-axi-home-");
    const r = await withEnv({ HOME: home }, () => run(["setup", "hooks"]));
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("status: installed");
  });

  it("rejects unknown setup actions", async () => {
    const r = await run(["setup", "bogus"]);
    expect(r.exit).toBe(2);
    expect(r.stdout).toContain("Unknown setup action");
  });
});
