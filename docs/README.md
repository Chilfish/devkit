# Documentation index

This directory is the single entry point for project documentation. **Every new document must be registered in the tables below**; `bun run check:docs` enforces it.

## Three mandatory document types

Only these changes require a document before code; everything else gets a same-day [development log](./development-log/README.md) entry:

1. Public contract changes (exports, types, behavior semantics)
2. Build or release flow changes
3. Incidents and reliability fixes ([postmortem](./postmortem/README.md))

## Guides

| Document | Description | When to read |
|---|---|---|
| [guide/getting-started.md](./guide/getting-started.md) | Install, configure, wire up the CLI and dev commands | First time using devkit |
| [guide/usage.md](./guide/usage.md) | Daily development and repository commands | Daily work |
| [guide/local-dev.md](./guide/local-dev.md) | Postgres, proxy and SILO: behavior, stop, reset | Local stack issues |
| [guide/cli.md](./guide/cli.md) | `CommandSpec`, `--json`, exit codes, logs, `describe` | Adding a command |

## Engineering

| Document | Description | When to read |
|---|---|---|
| [engineering/architecture.md](./engineering/architecture.md) | Layers, entry matrix, runtime boundaries | Adding a module or entry |
| [engineering/code-style.md](./engineering/code-style.md) | Naming, imports, types and error handling | Every time you write code |
| [engineering/testing.md](./engineering/testing.md) | Test layers, naming, coverage | Adding features or fixing bugs |
| [engineering/build-and-release.md](./engineering/build-and-release.md) | Multi-entry build, artifacts, release flow | Changing build config or releasing |
| [engineering/ci.md](./engineering/ci.md) | Pipeline structure, cache, gates and troubleshooting | Changing workflows or CI failures |
| [engineering/dependencies.md](./engineering/dependencies.md) | Dependency policy, peers, upgrades | Adding or upgrading dependencies |
| [engineering/security.md](./engineering/security.md) | Supply chain, secrets, OIDC, vulnerability response | Secrets, releases or security work |
| [engineering/git-workflow.md](./engineering/git-workflow.md) | Branches, commit messages, hooks, PRs | Before committing |
| [engineering/release-checklist.md](./engineering/release-checklist.md) | Step-by-step release checklist | Every release |

## Planning

| Document | Description |
|---|---|
| [planning/README.md](./planning/README.md) | Planning directory conventions and status |
| [planning/current-state.md](./planning/current-state.md) | Audit of duplicated infrastructure in two downstream projects (2026-11-19) |
| [planning/devkit-design.md](./planning/devkit-design.md) | Package shape, public API, migration stages and acceptance criteria |

## Reference

| Document | Description |
|---|---|
| [reference/api.md](./reference/api.md) | Public exports per entry |
| [reference/config.md](./reference/config.md) | Configuration fields, defaults and validation |
| [reference/commands.md](./reference/commands.md) | Built-in `dev` commands and options |
| [reference/package-contract.md](./reference/package-contract.md) | `package.json` field contract |

## Postmortems

| Document | Description |
|---|---|
| [postmortem/README.md](./postmortem/README.md) | Postmortem index and pitfall checklist |
| [postmortem/TEMPLATE.md](./postmortem/TEMPLATE.md) | Template for new postmortems |

## Development logs and archive

| Document | Description |
|---|---|
| [development-log/README.md](./development-log/README.md) | Daily development log conventions |
| [archive/README.md](./archive/README.md) | Archive for superseded documents |

## Conventions

- **Docs are facts**: paths, commands and fields must match the current code; fix drift where you find it.
- **Docs first**: only for the three mandatory types above; no process gate otherwise.
- **Archive instead of deleting**: move superseded documents into `archive/`.
- `bun run check:docs` fails when a document is unregistered or a link is broken.
