# Security

## Supply chain

- Releases use **npm Trusted Publisher (OIDC)**; no long-lived `NPM_TOKEN`.
- `npm publish --provenance` attaches a verifiable provenance statement.
- Dependency upgrades arrive as Dependabot PRs and must pass the full gate.
- Never commit `.env`, tokens or certificates; `.gitignore` covers the common cases.

## Secrets

| Kind | Storage | Notes |
|---|---|---|
| npm publish credential | GitHub OIDC | No static secret |
| `GITHUB_TOKEN` | Injected by Actions | Least privilege |
| Local development secrets | `.env`, `.env.dev`, `.env.prod` (ignored) | Never in the repository; commit `.env.example` only |

- Never `echo` secrets in workflows; use `printf` when writing files.
- New secrets must be documented here and in [build-and-release](./build-and-release.md).

## Permissions

- CI: `contents: read`.
- Publish: `contents: read` + `id-token: write` (required by OIDC).
- `contents: write` needs a documented reason.

## Code boundaries

- Only `.` and `./shared` are browser/Worker-safe; everything else is explicitly Node or Bun.
- Validate external input at the boundary; trust the type system internally.
- No `eval`, `new Function` or dynamic `require`.
- The proxy only accepts local database URLs, so it cannot expose a remote database on localhost.

## Vulnerability response

1. Do not disclose exploit details in issues; use GitHub Security Advisories.
2. Reproduce, then publish a patch and document the impact in `CHANGELOG.md`.
3. Deprecate affected versions with `npm deprecate` if needed.
4. Record the incident in [postmortem](../postmortem/README.md) and add tests and rules.
