# jev-axi

Agent-ergonomic CLI for TypeSafe's Jev (typed judgments: choice / noul / score).
Private repo `jaykang-heo/jev-axi`; installed from GitHub tags, never published
to npm (`"private": true` — do not add publish steps or `npm publish`).

## Build / test

- `pnpm install` then `pnpm run build` (tsc → `dist/`).
- `pnpm test` — vitest; `test/global-setup.ts` builds `dist` once so
  `test/compiled.test.ts` can exercise the real entrypoint.
- `JEV_AXI_LIVE=1 TYPESAFE_API_KEY=... pnpm test` adds `test/live.test.ts`
  (real API calls; asserts the pinned model answers).
- `pnpm run build:skill` regenerates `skills/jev-axi/SKILL.md` from
  `src/skill.ts`; `test/skill.test.ts` fails if the committed copy is stale.
  The stub is capped at 2500 chars and must defer guidance to the CLI.

## Conventions

- TypeScript ESM, Node >=20, axi-sdk-js runtime (`runAxiCli`), TOON output.
- `bin/jev-axi.ts` is a fast-path shim; `src/version.ts` is a leaf module —
  keep its imports to node builtins only.
- `src/cli.ts` owns top-level help/dispatch. Per-command `HELP` and `FLAGS`
  constants are the help-contract test's source of truth: a new flag must
  appear in both.
- Request shape and key handling originate from `bin/fm-dispatch-resolve.sh`
  in the firstmate repository — keep parity when the vendor contract changes.
- Errors are `AxiError`s: `VALIDATION_ERROR`/`NO_KEY` → exit 2, everything
  else → 1 (`formatError` in `src/cli.ts`).

## Key handling (non-negotiable)

`src/key.ts` captures `TYPESAFE_API_KEY` into module state at `initialize` and
deletes the env var, so spawned children never inherit it. Fallback:
`~/.config/jev-axi/env`, mode `600` enforced. `src/request.ts` sends the key
to curl as `-H @/dev/fd/3`, where fd 3 is a real pipe built by bash process
substitution and fed by `cat` from our fd-4 pipe — never argv, never a
file, never output (a Node stdio pipe is a socketpair, which Linux cannot
reopen via /dev/fd). `test/key-safety.test.ts` asserts all of this with a
fake curl; it must stay green before any commit.

## Release

Conventional commits on `main`; release-please opens the release PR; merging
it creates the `jev-axi-vX.Y.Z` tag + GitHub Release. `CHANGELOG.md` and
`.release-please-manifest.json` are generated — never hand-edit (a workflow
guards them). `src/commands/update.ts` overrides the SDK's npm-registry update
with GitHub-tag resolution (`gh api` → `git ls-remote` fallback) and
`npm install -g github:jaykang-heo/jev-axi#<tag>`.

## Tests are the contract

`test/commands.test.ts` pins the request body shape, answer validation, and
the exit-code matrix against a fake curl that records argv/env/fd3/body —
extend the matrix there when behavior changes.
