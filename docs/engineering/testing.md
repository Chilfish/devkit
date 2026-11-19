# Testing

## Layers

| Layer | Location | Dependencies | Content |
|---|---|---|---|
| Unit | `tests/**` | none | Config validation, env precedence, env-file order, URL checks, envelopes, exit codes |
| Contract | `tests/exports.test.ts`, `tests/contract/` | filesystem, Bun CLI | Entry matrix, `package.json` shape, browser-target build |
| Integration | `tests/**` (opt-in) | local Postgres / SILO | Database creation, migrations, proxy queries, `/health` |

Test directories mirror `src/`: `tests/cli/runtime.test.ts` covers `src/cli/runtime.ts`.

## Naming

- Files use `*.test.ts`; integration tests may use `*.e2e.test.ts`.
- Test names describe behavior and outcome.
- Group related cases with `describe`; use `it.each` for matrices.

## Tools

- Vitest with `globals: true`.
- Shared fixtures live in `tests/testkit/`; stronger fakes stay local to the file.
- Build objects with factories instead of sharing mutable state through `beforeEach`.

## Environment isolation

Tests that touch `process.env`, the working directory or temp files must snapshot and restore them:

```ts
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})
```

## Coverage

`bun run test:coverage` uses v8 with `text-summary`, `json-summary` and `lcov` in `coverage/`.

- Thresholds are a ratchet: raise them, never lower them to pass CI.
- New logic needs tests; bug fixes start with a failing test.

## Integration opt-in

Database integration tests run only with a local Postgres available (`DEVKIT_PG_SMOKE=1`). The proxy handler is tested in-process; `startProxy` requires Bun.

## Forbidden

- Shared mutable state between tests.
- Network or wall-clock dependent unit tests.
- Empty assertions such as `expect(true).toBe(true)`.
