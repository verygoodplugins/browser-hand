import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("tabs --query without a value is an argument error, not a full inventory", () => {
  const result = runCli(["tabs", "--query"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--query requires a non-empty value/);
});

test("tabs --query empty string is an argument error", () => {
  const result = runCli(["tabs", "--query", ""]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--query requires a non-empty value/);
});
