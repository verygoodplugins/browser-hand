import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = path.resolve(import.meta.dirname, "..");

const clientRoots = ["entrypoints", "services", "utils", "account"];

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".wxt") continue;
      files.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|css|html)$/.test(entry)) files.push(full);
  }
  return files;
}

describe("Clerk secrets stay out of the extension bundle sources", () => {
  it("does not mention the secret env var in client code", () => {
    const offenders: string[] = [];
    for (const root of clientRoots) {
      for (const file of sourceFiles(path.join(extensionRoot, root))) {
        const text = readFileSync(file, "utf8");
        if (
          /import\.meta\.env\.CLERK_SECRET|process\.env\.CLERK_SECRET|process\.env\.CLERK_PLATFORM/.test(
            text
          )
        ) {
          offenders.push(path.relative(extensionRoot, file));
        }
        if (/sk_(test|live)_[A-Za-z0-9]/.test(text)) {
          offenders.push(path.relative(extensionRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
