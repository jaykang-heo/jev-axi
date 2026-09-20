import { AxiError } from "axi-sdk-js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/** Get a flag's value from --flag value or --flag=value and remove it from args. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = arg.slice(equalsPrefix.length);
      args.splice(i, 1);
      return val;
    }
  }
  return undefined;
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function requireFlagValue(value: string, flag: string): string {
  if (value.trim() === "")
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  return value;
}

/**
 * Like takeFlag, but throws VALIDATION_ERROR when the flag is present with a
 * missing or blank value, rather than silently returning undefined for it.
 * A following option token (`--state --json`) is treated as a missing value,
 * not consumed as one; use `--flag=value` for a dash-leading value.
 */
export function takeRequiredFlag(
  args: string[],
  flag: string,
): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      if (val === undefined || val.startsWith("--"))
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
      args.splice(i, 2);
      return requireFlagValue(val, flag);
    }
    if (arg.startsWith(equalsPrefix)) {
      args.splice(i, 1);
      return requireFlagValue(arg.slice(equalsPrefix.length), flag);
    }
  }
  return undefined;
}

/**
 * Collect all values for a repeatable flag in --flag value or --flag=value
 * form and remove them from args. Throws VALIDATION_ERROR if any occurrence
 * has a missing or blank value, rather than silently dropping it.
 */
export function takeAllFlags(args: string[], flag: string): string[] {
  const result: string[] = [];
  const equalsPrefix = flagEqualsPrefix(flag);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === flag) {
      result.push(requireFlagValue(args[i + 1] ?? "", flag));
      args.splice(i, 2);
    } else if (arg.startsWith(equalsPrefix)) {
      result.push(requireFlagValue(arg.slice(equalsPrefix.length), flag));
      args.splice(i, 1);
    } else {
      i++;
    }
  }
  return result;
}

/**
 * Reject flags in `args` that are not listed in `known`, after the command
 * has parsed the flags it recognizes. Positionals and `--help`/`-h` always
 * pass; `--` ends flag scanning. Value forms (`--flag=v`) are matched by flag
 * name only. Throws VALIDATION_ERROR listing every offending flag plus a
 * one-turn self-correction hint, per AXI principle 6: never silently drop an
 * unknown flag.
 */
export function rejectUnknownFlags(
  args: string[],
  known: readonly string[],
  command: string,
): void {
  const knownSet = new Set(known);
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === "--") break;
    // A bare `-` is the stdin sentinel (`--state -`), a value rather than a flag.
    if (tok === "-" || !tok.startsWith("-")) continue;
    const name = tok.split("=", 1)[0];
    if (name === "--help" || name === "-h") continue;
    if (knownSet.has(name)) continue;
    if (!unknown.includes(name)) unknown.push(name);
  }
  if (unknown.length === 0) return;
  const list = unknown.join(", ");
  throw new AxiError(
    `unknown flag${unknown.length > 1 ? "s" : ""} for jev-axi ${command}: ${list}`,
    "VALIDATION_ERROR",
    [`jev-axi ${command} [flags]`, `jev-axi ${command} --help`],
  );
}

/** Read a flag's value without consuming it (for pre-validation). */
export function flagValueOf(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) return args[i + 1];
    if (args[i].startsWith(equalsPrefix)) return args[i].slice(equalsPrefix.length);
  }
  return undefined;
}

/** Reject positional arguments left after flag parsing. */
export function rejectPositionals(args: string[], command: string): void {
  const rest = args.filter((a) => a !== "--");
  if (rest.length === 0) return;
  throw new AxiError(
    `unexpected argument${rest.length > 1 ? "s" : ""} for jev-axi ${command}: ${rest.join(", ")}`,
    "VALIDATION_ERROR",
    [`jev-axi ${command} [flags]`, `jev-axi ${command} --help`],
  );
}
