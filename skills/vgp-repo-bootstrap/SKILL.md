---
name: vgp-repo-bootstrap
description: >
  Bootstrap or repair the standard Very Good Plugins agent-facing project surface:
  AGENTS.md as canonical, CLAUDE.md as @AGENTS.md, MIGRATING.md when renaming,
  GitHub hygiene (SECURITY, PR/issue templates, CODEOWNERS, dependabot), and
  product vs MCP naming discipline. Use when spinning up a new VGP repo, forking
  an upstream project, renaming product/CLI/skill identifiers, or when a repo
  still treats CLAUDE.md as the only agent contract. Trigger phrases: new project
  scaffold, agents.md bootstrap, claude.md to agents.md, repo hygiene, SECURITY.md,
  migrating file, standardize this repo, spin up a product repo.
license: MIT
compatibility: Local git checkout; GitHub org verygoodplugins (or autoworks-ai) conventions.
category: meta
tags: [agents-md, bootstrap, hygiene, security, conventions, vgp]
agents: [claude-code, codex, grok]
metadata:
  author: verygoodplugins
  version: "0.1.0"
resources:
  - path: references/checklist.md
    type: file
  - path: templates/AGENTS.md.template
    type: file
  - path: templates/CLAUDE.md.template
    type: file
  - path: templates/MIGRATING.md.template
    type: file
  - path: templates/SECURITY.md.template
    type: file
  - path: templates/PULL_REQUEST_TEMPLATE.md.template
    type: file
  - path: templates/CODEOWNERS.template
    type: file
---

# VGP repo bootstrap

Spin up (or repair) the **agent + hygiene surface** every VGP product or tool repo should share — without reinventing it from AutoVault, mcp-ecosystem, or memory.

This skill is **not** the MCP server scaffolder. For MCP servers, use `mcp-ecosystem` (`create-server.sh` / `apply-templates.sh` / `STANDARDS.md`). For everything else (CLI tools, extensions, agent skills monorepos, product forks), use this checklist.

## When to load

- New public or private VGP repo that agents will edit
- Fork of an upstream project that still says only `CLAUDE.md` / old product name
- Repo still has full agent rules in `CLAUDE.md` and no real `AGENTS.md`
- Missing `SECURITY.md`, PR template, CODEOWNERS, or dependabot
- Product rename (e.g. `dev-browser` → `browser-hand`) needs a `MIGRATING.md`

## Canonical agent surface (locked)

| File | Role |
|---|---|
| **`AGENTS.md`** | **Single source of truth** for coding agents (all hosts) |
| **`CLAUDE.md`** | Exactly one line: `@AGENTS.md` (Claude Code import; no duplicate body) |
| **`MIGRATING.md`** | Required when renaming product/CLI/skill or forking with a new brand |
| **`README.md`** | Humans; link AGENTS + MIGRATING when relevant |
| **`CONTRIBUTING.md`** | Humans; point agents at AGENTS.md |
| **`.github/SECURITY.md`** | Private vulnerability reporting |
| **`.github/PULL_REQUEST_TEMPLATE.md`** | Conventional-commit-friendly PR body |
| **`.github/ISSUE_TEMPLATE/*`** | Bug + feature + security contact link |
| **`.github/CODEOWNERS`** | Default reviewers |
| **`.github/dependabot.yml`** | Dependency PRs |

Reference implementations:

- MCP (fleet pattern): `mcp-wp`, `mcp-automem` — `CLAUDE.md` is `@AGENTS.md`
- Product (this monorepo’s parent): **browser-hand** after bootstrap
- Deep product AGENTS body: **autovault** (architecture + commands; may still have a fat CLAUDE.md — prefer the import pattern for *new* work)

## Workflow

1. **Detect** existing surface: list root `AGENTS.md`, `CLAUDE.md`, `MIGRATING.md`, `.github/*`.
2. **Classify**:
   - `mcp` → hand off to mcp-ecosystem templates; still enforce `@AGENTS.md` import.
   - `product` / `fork` → apply this skill’s templates.
3. **Fill placeholders** from `references/checklist.md` (name, slug, description, stack, commands).
4. **Write files** from `templates/` (do not leave a fat `CLAUDE.md` body).
5. **Rename discipline**: update agent-facing strings (skill name, CLI, README product name). Leave intentional upstream package/binary names only when documented in `MIGRATING.md`.
6. **Verify**:
   - `CLAUDE.md` is exactly `@AGENTS.md` (plus optional trailing newline)
   - `AGENTS.md` states that it is canonical
   - Security template points at the real `github.com/<org>/<repo>/security/advisories/new`
   - No second conflicting “project rules” file that agents will load instead

## Anti-patterns

- Symlinking `CLAUDE.md` → `AGENTS.md` with a body titled `# CLAUDE.md` (breaks the import convention and confuses fleet sweeps)
- Duplicating the full AGENTS body into CLAUDE.md “for Claude”
- Storing secrets or machine-local paths in AGENTS.md
- Treating AutoHub (or any hub) as required runtime when the product is self-contained — document hubs as optional adapters (see browser-hand `docs/ecosystem-links.md` pattern)
- Renaming without `MIGRATING.md` while old skill names remain in the wild

## After bootstrap

- Commit with conventional message, e.g. `docs: AGENTS.md canonical + GitHub hygiene`
- If the repo ships a skill, admit/update it via AutoVault rather than only copying into `~/.claude/skills`
- For MCP servers, still run `mcp-ecosystem` audit/apply for workflows and `server.json`

## Placeholders used in templates

| Token | Example |
|---|---|
| `{Product Name}` | Browser Hand |
| `{repo}` | browser-hand |
| `{org}` | verygoodplugins |
| `{cli}` | browser-hand |
| `{slug}` | browser-hand (AutoMem bare tag) |
| `{one-liner}` | Agents control real logged-in Chrome via a local extension bridge |
| `{old-name}` | dev-browser |
