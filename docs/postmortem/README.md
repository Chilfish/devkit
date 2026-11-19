# Postmortems

Write one postmortem after every production or release incident, numbered in order: `NNN-short-slug.md`.

## Index

| Number | Topic | Root cause | Lesson |
|---|---|---|---|
| — | None yet | — | — |

## High-frequency pitfall checklist

Run through this before changing code or configuration.

### Build and artifacts

- Did `tsdown.config.ts` accidentally enable `exports: true` and overwrite hand-maintained `exports`?
- When adding a subpath entry, did both the `entry` map and `package.json#exports` change?
- Did a neutral entry (`src/index.ts`, `src/shared/`) gain a runtime `node:*` import?

### Dependencies and lockfile

- Did you change `package.json` without updating `bun.lock`?
- CI uses `--frozen-lockfile`; a mismatch fails immediately.

### CI and release

- Do the action versions exist? (`checkout@v4`, `setup-bun@v2`, `setup-node@v4`)
- Is publishing still OIDC-based, with no `NPM_TOKEN` or `registry-url`?
- Does `CHANGELOG.md` contain the version section, and does the tag match `package.json#version`?

### Tests

- Does new logic have tests?
- Are any tests dependent on real network access or wall-clock time?

### Docs

- Are public contracts, build flow and incident fixes documented?
- Do documented commands, paths and fields still match the code?

## Writing requirements

- Facts first: timeline, evidence, impact.
- Root causes must be actionable, not "carelessness".
- Every lesson must land in this checklist or `AGENTS.md`.
- Use [TEMPLATE.md](./TEMPLATE.md).
