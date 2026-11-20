# Testing

## Layers

| Layer | Location | Dependencies | Content |
|---|---|---|---|
| Unit | `tests/**` | none | Config validation, env precedence, env-file order, URL checks, envelopes, exit codes |
| Contract | `tests/exports.test.ts`, `tests/contract/` | filesystem, Bun CLI | Entry matrix, `package.json` shape, browser-target build |
| E2E | `tests/e2e/` | Bun | Real CLI process: help, `describe`, exit codes, envelopes, implicit JSON switch |
| Integration | `tests/integration/` | local Postgres, Bun | Create database, apply drizzle migrations, proxy single/batch query, `/health`, background proxy start/reuse/conflict |

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
- Current thresholds live in `vitest.config.ts`: `statements` 63, `branches` 57, `functions` 62, `lines` 64.
- New logic needs tests; bug fixes start with a failing test.

## Integration opt-in

Database integration tests run only when `DEVKIT_PG_SMOKE=1` is set and a server is reachable:

```bash
DEVKIT_PG_SMOKE=1 bun run test:integration
DEVKIT_PG_SMOKE=1 DEVKIT_PG_ADMIN_URL=postgres://postgres@localhost:5432/postgres bun run test:integration
```

They create a uniquely named database, apply `tests/fixtures/migrations`, exercise the proxy handler in-process, and drop the database afterwards. The proxy lifecycle test also spawns the real background entry, checks `/health`, verifies reuse, and verifies the conflict error for another database.

The proxy handler is tested in-process; `startProxy` requires Bun.

CI runs the integration suite in the `integration` job against a `postgres:16`
service, including a test that drives the official
`@neondatabase/serverless` client against the background proxy entry. The
`windows` job runs the unit, contract and e2e layers on Windows.

## Forbidden

- Shared mutable state between tests.
- Network or wall-clock dependent unit tests.
- Empty assertions such as `expect(true).toBe(true)`.
