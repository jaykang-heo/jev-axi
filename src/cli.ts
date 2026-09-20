import { encode } from "@toon-format/toon";
import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { askCommand, HELP as ASK_HELP } from "./commands/ask.js";
import { choiceCommand, HELP as CHOICE_HELP } from "./commands/choice.js";
import { homeCommand } from "./commands/home.js";
import { noulCommand, HELP as NOUL_HELP } from "./commands/noul.js";
import { scoreCommand, HELP as SCORE_HELP } from "./commands/score.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { updateCommand, UPDATE_HELP } from "./commands/update.js";
import { captureEnvironmentKey } from "./key.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Typed judgments about a text from typesafe.ai's Jev: pick one option from a set, a yes/no probability, or a score against a rubric, in under a second. Numbers only, never prose, never a decision. Use it when your code needs one closed decision about a text and a confidence to threshold on.";

export const TOP_HELP = `usage: jev-axi [command] [args] [flags]
commands[7]:
  (none)=dashboard, choice, noul, score, ask, setup, update
flags[6]:
  --state <file|-> (required on every question; the text judged, read verbatim), --timeout <s> (default 5, max 30), --model <id> (default jev-1.13.0), --json, --help, -v/-V/--version
examples:
  jev-axi choice --state bug.txt --option code="The fault is in application code" --option env="The fault is in the environment" --none
  jev-axi noul --state diff.txt --ask "The change handles the empty case correctly"
  jev-axi score --state post.txt --rubric publishability.txt
  jev-axi ask --state post.txt --questions-file questions.json
  jev-axi choice --state email.txt --options-file options.json --json
`;

const COMMAND_HELP: Record<string, string> = {
  choice: CHOICE_HELP,
  noul: NOUL_HELP,
  score: SCORE_HELP,
  ask: ASK_HELP,
  setup: SETUP_HELP,
  update: UPDATE_HELP,
};

export async function main(
  options: {
    argv?: string[];
    stdout?: { write: (chunk: string) => unknown };
  } = {},
): Promise<void> {
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    initialize: () => captureEnvironmentKey(),
    home: () => homeCommand(),
    commands: {
      choice: (args) => choiceCommand(args),
      noul: (args) => noulCommand(args),
      score: (args) => scoreCommand(args),
      ask: (args) => askCommand(args),
      setup: (args) => setupCommand(args),
      update: (args) => updateCommand(args),
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode:
          axiError.code === "NO_KEY" ? 2 : exitCodeForError(axiError),
      };
    },
  });
}
