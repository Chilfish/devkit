# Dependencies

## Policy

- **Runtime dependencies are deliberate**: `commander` for the CLI and `aws4fetch` for S3 request signing. Any addition needs a PR note covering necessity, size and alternatives.
- **Database drivers are optional peers**: `pg` and `drizzle-orm` so downstream versions are not forced to upgrade.
- **Toolchain in devDependencies**: build, test, lint and release tooling never ships.
- **Caret ranges**, locked by `bun.lock`.
- **Never edit the lockfile by hand.**

## Classification

| Kind | Location | Examples |
|---|---|---|
| Runtime | `dependencies` | `commander`, `aws4fetch` |
| Optional peer | `peerDependencies` + `peerDependenciesMeta` | `pg`, `drizzle-orm` |
| Tooling | `devDependencies` | `tsdown`, `vitest`, `eslint` |
| Types | `devDependencies` | `@types/node`, `@types/bun`, `@types/pg` |

`pg` and `drizzle-orm` are imported dynamically inside local database operations, so entries that do not touch the database work without them.

## Upgrade flow

```bash
bun outdated
bun update <pkg>
bun run check
git diff bun.lock
```

- Run `bun run check` and `bun run check:docs` after upgrades.
- Record major upgrades in the CHANGELOG.
- Roll back rather than bypassing peer conflicts with `--force`.

## New dependency checklist

- [ ] Is it really needed? Can the standard library or an existing dependency do it?
- [ ] License compatible (MIT)?
- [ ] ESM-ready and, if needed, CJS-compatible?
- [ ] Does it pull `node:` builtins into a neutral entry?
- [ ] Does it significantly increase install size?
- [ ] Added to the correct section and `bun.lock` updated?

## Automation

`.github/dependabot.yml` checks Bun dependencies weekly. Dependabot PRs must pass the full CI gate.

`typescript >=7` is currently ignored because `typescript-eslint` does not support it yet; remove the ignore when upstream catches up.
