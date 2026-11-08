import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Load Browser Hand env files into process.env.
 *
 * Real environment variables win. Among files, later entries win:
 * extension/.env, extension/.env.local, <root>/.env, <root>/.env.local.
 * The canonical file is the repo-root `.env` (see `.env.example`).
 *
 * @param {string} repoRoot
 */
export function loadBrowserHandEnv(repoRoot) {
  const locked = new Set(Object.keys(process.env));
  const files = [
    path.join(repoRoot, "extension", ".env"),
    path.join(repoRoot, "extension", ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
  ];

  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    let parsed;
    try {
      parsed = parseEnv(readFileSync(filePath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not parse ${filePath}: ${message}`);
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (locked.has(key)) continue;
      process.env[key] = value;
    }
  }
}
