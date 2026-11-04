import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentTypeForPath, readLocalFile } from "./local-file.ts";

test("contentTypeForPath maps known extensions", () => {
  assert.equal(contentTypeForPath("/tmp/brief.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeForPath("/tmp/report.HTML"), "text/html; charset=utf-8");
  assert.equal(contentTypeForPath("/a/b/data.json"), "application/json; charset=utf-8");
  assert.equal(contentTypeForPath("/a/logo.svg"), "image/svg+xml");
  assert.equal(contentTypeForPath("/a/shot.png"), "image/png");
  assert.equal(contentTypeForPath("/a/doc.pdf"), "application/pdf");
});

test("contentTypeForPath defaults to octet-stream", () => {
  assert.equal(contentTypeForPath("/tmp/archive.bin"), "application/octet-stream");
  assert.equal(contentTypeForPath("/tmp/noext"), "application/octet-stream");
});

test("readLocalFile serves an existing file with its content type", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bh-localfile-"));
  const filePath = join(dir, "brief.html");
  await writeFile(filePath, "<h1>hi</h1>", "utf8");
  try {
    const result = await readLocalFile(filePath);
    assert.equal(result.status, 200);
    assert.equal(result.contentType, "text/html; charset=utf-8");
    assert.equal(Buffer.from(result.body).toString("utf8"), "<h1>hi</h1>");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readLocalFile reports 400 for a missing path and 404 for a missing file", async () => {
  const missingPath = await readLocalFile(undefined);
  assert.equal(missingPath.status, 400);

  const missingFile = await readLocalFile(join(tmpdir(), "bh-does-not-exist-xyz.html"));
  assert.equal(missingFile.status, 404);
});
