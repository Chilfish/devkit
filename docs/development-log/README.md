# Development log

Record the day's work as `YYYY-MM-DD.md`.

## When to write

- Changes outside the three mandatory document types (public contract / build and release / incident).
- Decision and debugging processes, rejected approaches.
- Intermediate states of large changes, so the next session can continue.

## Format

```md
# 2026-11-18

## Done

- Migrated to tsdown + Bun
- Added docs system and check:docs gate

## Decisions

- Release uses OIDC instead of NPM_TOKEN to avoid long-lived secrets

## Follow-ups

- Add an examples/api scenario
- Evaluate changesets
```

## Conventions

- Logs are not part of the gate and need not be complete.
- Anything touching a public contract or an incident also goes into a formal document; the log only links to it.
- This directory is exempt from the `docs/README.md` index check.
