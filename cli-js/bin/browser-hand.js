#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(root, "..", "src", "cli.js");

// cli.js only runs main() when it is the entry module, which it decides by
// comparing process.argv[1] against its own path. Loaded through this shim that
// check is false, so the CLI used to exit 0 having printed nothing. Point argv[1]
// at cli.js so the guard sees what it expects.
process.argv[1] = cliPath;

await import(pathToFileURL(cliPath).href);
