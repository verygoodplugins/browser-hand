# VGP repo bootstrap checklist

Use this for every new product/tool repo (and when repairing an older one).

## 0. Identity (fill first)

- [ ] Product name: `{Product Name}`
- [ ] GitHub: `{org}/{repo}`
- [ ] CLI / primary binary (if any): `{cli}`
- [ ] AutoMem bare slug: `{slug}` (unique; not a common word)
- [ ] One-liner: `{one-liner}`
- [ ] Stack (Node / Rust / Python / mixed): ________
- [ ] Fork of: ________ (or none)
- [ ] Old names that agents still type: `{old-name}` (or none)

## 1. Agent surface

- [ ] `AGENTS.md` exists, titled `# AGENTS.md`, states it is canonical
- [ ] Sections present: Project, Common commands, Architecture (or layout), Validation, Naming (if rename), Related docs
- [ ] `CLAUDE.md` is **exactly** `@AGENTS.md` (no symlink, no duplicated body)
- [ ] `MIGRATING.md` if rename/fork with new brand
- [ ] `CONTRIBUTING.md` points agents at `AGENTS.md` and security at private advisories
- [ ] README links AGENTS (and MIGRATING when relevant)

## 2. GitHub hygiene

- [ ] `.github/SECURITY.md` — real advisories URL for this repo
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` — conventional commits hint
- [ ] `.github/ISSUE_TEMPLATE/config.yml` — security contact; blank issues off if desired
- [ ] `.github/ISSUE_TEMPLATE/bug_report.yml`
- [ ] `.github/ISSUE_TEMPLATE/feature_request.yml`
- [ ] `.github/CODEOWNERS`
- [ ] `.github/dependabot.yml` — ecosystems that match the stack
- [ ] CI workflow exists (project-specific; not invented blindly)

## 3. MCP-only extras (skip for product repos)

- [ ] Hand off to `mcp-ecosystem`: `create-server.sh` / `apply-templates.sh` / `audit-server.sh`
- [ ] `server.json`, `STANDARDS.md` compliance, release-please, OIDC publish

## 4. Skill packaging (if agent skill ships in-repo)

- [ ] `skills/{name}/SKILL.md` with frontmatter: `name`, `description`, `agents: [...]`
- [ ] AutoVault admit path documented in README
- [ ] Legacy skill alias (if rename) points to new name — temporary, documented in MIGRATING

## 5. Naming sweep (agent-facing only)

- [ ] README / AGENTS / skill / CONTRIBUTING use product name + CLI
- [ ] Stale product strings fixed; intentional upstream package names listed in MIGRATING
- [ ] No “edit CLAUDE.md only” instructions remain

## 6. Verify

```bash
# Agent surface
test "$(cat CLAUDE.md | tr -d '\n')" = "@AGENTS.md" || test "$(head -1 CLAUDE.md)" = "@AGENTS.md"
test -f AGENTS.md && head -1 AGENTS.md | grep -q AGENTS
test -f .github/SECURITY.md

# Optional: show remaining old-name hits for human triage
# rg -n '{old-name}' --glob '!node_modules' --glob '!**/dist/**' --glob '!**/bin/**'
```

## Source of truth chain

1. This skill (`vgp-repo-bootstrap`) — product/agent repos  
2. `mcp-ecosystem` — MCP server scaffolds + workflow templates  
3. Recent examples: browser-hand (product), autovault (deep AGENTS), mcp-automem / mcp-wp (`@AGENTS.md` import)
