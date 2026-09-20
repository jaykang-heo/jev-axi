import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { renderHelp, renderOutput } from "../toon.js";

export const SETUP_HELP = `usage: jev-axi setup hooks
Install or repair agent SessionStart hooks for jev-axi ambient context.

Optional for this tool: jev-axi's callers are mostly scripts and intake
tooling that invoke it explicitly, not agents needing ambient context.

examples:
  jev-axi setup hooks
`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError("Unknown setup action", "VALIDATION_ERROR", [
      "Run `jev-axi setup hooks`",
    ]);
  }
  installSessionStartHooks({ marker: "jev-axi" });
  return renderOutput([
    "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
    renderHelp([
      "Restart your agent session to receive jev-axi ambient context",
    ]),
  ]);
}
