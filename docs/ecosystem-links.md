# Ecosystem links (internal style guide)

How Browser Hand and sibling repos should point at the larger stack without advertising.

## Principles

1. **Each repo is useful alone.** Core install never requires another product.
2. **One hub per concern.** Skills → AutoVault. Memory → AutoMem. Browser → Browser Hand.
3. **Hub first only when it is the install path.** Browser Hand leads skill install with AutoVault; runtime stays clone-based.
4. **Adjacent products live at the bottom** in a short “Works with” table — one line each, no logos splash.
5. **Define the hub in one sentence** the first time you name it.

## Copy patterns

**AutoVault (skill delivery):**

> AutoVault is a local-first vault for agent skills: it validates and signs skill packages, then syncs them into your agents so you are not copy-pasting `SKILL.md` files by hand.

Install example:

```bash
autovault add verygoodplugins/browser-hand:skills/browser-hand/SKILL.md --sync-profiles
```

**AutoMem (memory):**

> Need durable recall across sessions? [AutoMem](https://github.com/verygoodplugins/automem) is the memory layer — complementary, not required for this tool.

## Anti-patterns

- “Part of our suite!” hero blocks
- Gating core functionality behind AutoVault or AutoMem
- More than one primary hub CTA in the install section
- Hard sell language (“you must”, “unlock”, “premium”)

## Agent project surface

New VGP product repos should ship the same agent/hygiene surface (canonical `AGENTS.md`, `@AGENTS.md` import, optional `MIGRATING.md`, `.github` security/PR hygiene). See skill `skills/vgp-repo-bootstrap/` in this monorepo — promote into AutoVault when it stabilizes.
