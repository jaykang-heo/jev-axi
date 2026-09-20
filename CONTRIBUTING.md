# Contributing

Private repository — contributions land as ordinary pull requests on `main`.

## Workflow

1. Clone, `pnpm install`.
2. Branch, change, commit with a conventional message (`feat:` / `fix:` /
   `docs:` / `chore:` / `test:` / `refactor:`) — release-please builds the
   changelog and version bumps from these.
3. `pnpm run build` and `pnpm test` must pass before pushing.
4. Open a PR against `main`. CI runs build+test; a guard rejects hand-edits
   to `CHANGELOG.md` and `.release-please-manifest.json` (release-please
   owns them).

## Repo conventions

- Node 20+, TypeScript, ESM-only, pnpm.
- `src/` is the command graph; `bin/jev-axi.ts` is a thin fast-path shim.
- Output is TOON for agents; errors are typed codes with corrective hints.
- `TYPESAFE_API_KEY` is never on argv, in child env, in output, or in logs —
  `test/key-safety.test.ts` enforces it.
- Regenerate `skills/jev-axi/SKILL.md` with `pnpm run build:skill` after
  touching `src/skill.ts`.
