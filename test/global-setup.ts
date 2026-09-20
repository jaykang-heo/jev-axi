import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Build dist/ once so compiled-CLI tests exercise the shipped entrypoint. */
export default function setup(): void {
  execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
}
