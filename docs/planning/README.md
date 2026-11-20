# Planning

This directory holds decisions and plans that are **not yet implemented**. Move finished or abandoned documents to `../archive/` and update `../README.md`.

| Document | Status | Description |
|---|---|---|
| [current-state.md](./current-state.md) | Final (2026-11-19) | Audit of duplicated infrastructure in the two downstream projects |
| [devkit-design.md](./devkit-design.md) | Draft (2026-11-19) | Package shape, public API, migration stages and acceptance criteria |
| [oss-review-2026-11-20.md](./oss-review-2026-11-20.md) | Implemented (2026-11-20) | Independent review, findings and the execution backlog |

## Conventions

- Planning documents describe goals and steps; never present unfinished work as current state.
- When the document and code disagree, the code wins and the document is fixed in place.
- New planning documents must be registered in the [index](../README.md); `bun run check:docs` enforces this.
- Paths, commands and field names in a plan must exist in the repository or a downstream project; no invented APIs.
