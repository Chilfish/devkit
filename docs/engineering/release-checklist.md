# Release checklist

Follow in order. Stop and fix on any failure.

## Before release

- [ ] `main` is clean and matches `origin/main`
- [ ] `CHANGELOG.md` `## Unreleased` covers every change in this release
- [ ] Breaking changes are called out in the CHANGELOG and docs
- [ ] Public export changes are reflected in `tests/exports.test.ts`

## Local gate

```bash
bun install --frozen-lockfile
bun run check
bun run check:docs
```

- [ ] All green
- [ ] Every entry exists under `dist/` (`index`, `shared/index`, `cli/index`, `env/index`, `local/index`, `proxy/index`, `storage/index`, `commands/index`, `bin/proxy.js`)
- [ ] `bun run verify:package` passes
- [ ] `node -e "require('./dist/index.cjs')"` and the ESM import both succeed

## Release

```bash
bun run release
```

- [ ] bumpp bumped the version, committed and tagged
- [ ] Tag pushed (`git push --follow-tags`)
- [ ] GitHub Actions `Publish` passes
- [ ] `npm view @chilfish/devkit@<version>` resolves
- [ ] GitHub Release created from the CHANGELOG section

## Rollback

- Published versions are immutable: ship a patch instead of overwriting.
- Deprecate broken versions with `npm deprecate` and name the replacement.
