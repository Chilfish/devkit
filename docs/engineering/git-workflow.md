# Git workflow

## Branches

- `main` is the only long-lived branch and is always releasable.
- Work happens on short-lived branches: `feat/<scope>`, `fix/<scope>`.
- Rebase onto the latest `main` before merging; keep history linear.

## Commit messages

Conventional Commits:

```
type(scope): short summary
```

Common types:

| Type | Use |
|---|---|
| `feat` | New capability |
| `fix` | Bug fix |
| `refactor` | Behavior-preserving change |
| `test` | Tests |
| `docs` | Documentation |
| `build` | Build or dependency changes |
| `ci` | Pipelines |
| `chore` | Everything else |

- One logical unit per commit; do not accumulate.
- Large changes split into three or four commits by module or file.
- No vague summaries such as "fix bug"; name the object and the behavior.

## Hooks (lefthook)

Configuration in `lefthook.yml`, installed by `bun install` via `prepare: lefthook install`.

| Hook | Behavior |
|---|---|
| pre-commit | `eslint --fix` on staged files, writes fixes back to the index |
| pre-push | `bun run build` |

- Avoid `--no-verify`; explain it in the PR if truly necessary.
- The full gate (typecheck, coverage) runs in CI.

## PRs

- Titles follow the commit format.
- Descriptions include motivation, behavior changes and verification.
- Public contract changes update the CHANGELOG and related docs.
- Diffs over ten files or 200 lines explain the split or split into commits.
