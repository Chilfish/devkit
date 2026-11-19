# Code style

Formatting and style checks are owned by ESLint (`@antfu/eslint-config`), not Prettier. Git hooks are managed by lefthook (`lefthook.yml`).

## Basics

- Single quotes, no semicolons, two-space indentation.
- Single-statement `if` bodies get a newline (enforced by `antfu/if-newline`).
- Import order: builtins → external → internal → parent/sibling; type imports first within a group.
- Type imports use `import type` / `export type` (`verbatimModuleSyntax`).
- No `any`; use `unknown` plus a type guard at the boundary.

## Naming

| Kind | Rule | Example |
|---|---|---|
| Variables / functions | camelCase | `parseResponse` |
| Types / interfaces | PascalCase, no `I` prefix | `RequestOptions` |
| Constants | UPPER_SNAKE only for true globals | `DEFAULT_TIMEOUT` |
| Files | kebab-case or domain name | `build-and-release.md`, `id-codec.ts` |
| Tests | `*.test.ts`, names describe behavior | `returns null for empty input` |

## Modules

- One primary responsibility per file; the top block comment explains why it exists and where the boundary is.
- No comments that restate the code.
- Internal helpers stay private unless they have standalone test value.
- Do not add abstractions for a single call site.

## Types

- Use discriminated unions for polymorphic shapes instead of many optional fields.
- Optional fields use `?`; explicitly nullable values use `| null`, never both.
- Public types are exported from entry index files only.

## Errors

- Never throw bare `new Error()` in command code; use `CliError`, `UsageError` or `ConfigError`.
- Error messages must identify the object: id, name or path.
- Validate at boundaries (user input, external responses); trust the type system internally.
- In batch operations, record per-item failures and continue, then summarize.
