# Contributing

Thanks for contributing. Read [docs/README.md](./docs/README.md) and [AGENTS.md](./AGENTS.md) first.

## Development flow

```bash
bun install
bun run check        # typecheck + lint + test:coverage + build + verify:package
bun run check:docs   # documentation links and index
```

## Branches and commits

- Branch from `main`: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`.
- Conventional Commits: `type(scope): short summary`.
- pre-commit runs `eslint --fix`; pre-push runs `build`.

## Code requirements

- Named exports only; no `export default`.
- Use `import type` for types.
- No `any`.
- New logic needs tests; bug fixes start with a failing test.
- Do not touch unrelated code or perform drive-by refactors.

## Documentation requirements

These changes update documentation first:

- Public contract changes (exports, types, behavior)
- Build or release flow changes
- Incident fixes (added under `docs/postmortem/`)

Other changes update `docs/development-log/`.

## Pull requests

- Titles follow the commit format.
- Descriptions cover motivation, behavior changes and verification.
- Public contract changes update `CHANGELOG.md` under `## Unreleased`.
- Request review once CI is green.

## Reporting issues

Use the [issue templates](https://github.com/Chilfish/devkit/issues/new/choose). Do not report security issues publicly; see [SECURITY.md](./SECURITY.md).
