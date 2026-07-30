# Contributing to Browser Hand

Thank you for your interest in contributing.

## Before you start

**Please open an issue before submitting a pull request.** That helps us:

- Discuss whether the change aligns with the product direction (real Chrome via extension first; headless as secondary)
- Avoid duplicate work
- Provide guidance on implementation approach

For bug reports, include steps to reproduce, `browser-hand doctor` output when relevant, and whether you used the extension path or upstream headless CLI. For feature requests, explain the use case.

## Agent / project conventions

- **`AGENTS.md` is canonical** for coding agents. Do not put lasting project rules only in `CLAUDE.md` (that file is `@AGENTS.md`).
- Product name is **Browser Hand** / CLI **`browser-hand`**. Reserve **`dev-browser`** for the upstream headless binary and historical config paths — see [MIGRATING.md](./MIGRATING.md).
- Security vulnerabilities: report privately via GitHub Security Advisories (see [`.github/SECURITY.md`](./.github/SECURITY.md)), not public issues.

## Pull request process

1. Open an issue describing the proposed change (unless it is a tiny docs fix).
2. Wait for maintainer feedback before large work when unsure.
3. Fork the repo and create a branch from `main`.
4. Make your changes. Prefer conventional commit messages (`feat:`, `fix:`, `docs:`, …).
5. Validate:

   **Extension / product CLI / relay:**

   ```bash
   npm run build:relay
   cd extension && npm test
   npm run doctor   # with extension + relay running, when you touch attach/CDP paths
   ```

   **Upstream daemon / Rust CLI:**

   ```bash
   cd daemon && npx tsc --noEmit && pnpm vitest run
   # if daemon runtime embedded in the binary changed:
   cd daemon && pnpm bundle && pnpm bundle:sandbox-client
   cd cli && cargo build
   ```

6. Open a PR with a clear summary and test plan. Keep PRs ready for review by default (draft only if still exploratory).

## Code of conduct

Be respectful. We assume good intent and prefer concrete repros over blame.
