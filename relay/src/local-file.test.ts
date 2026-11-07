import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LOCAL_DOC_TOKEN_PATTERN,
  LocalDocError,
  LocalDocRegistry,
  contentTypeForPath,
} from "./local-file.ts";

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

type Fixture = { base: string; report: string; index: string };

/** <base>/report/{index.html,style.css,sub/,.env,link-*}, <base>/report-secret/ (prefix sibling), <base>/outside.txt */
async function withFixture(run: (fx: Fixture) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "bh-localfile-")));
  const report = join(base, "report");
  try {
    await mkdir(join(report, "sub"), { recursive: true });
    await mkdir(join(base, "report-secret"));
    const files = ["report/index.html", "report/style.css", "report/sub/page.html"];
    for (const file of [...files, "report/.env", "report/.draft.html", "report/sub/.hidden"]) {
      await writeFile(join(base, file), `<p>${file}</p>`);
    }
    await writeFile(join(base, "report-secret", "secret.txt"), "sibling-prefix secret");
    await writeFile(join(base, "outside.txt"), "outside");
    await symlink(join(base, "report-secret"), join(report, "link-dir"));
    await symlink(join(base, "outside.txt"), join(report, "link-file"));
    await symlink(join(report, "style.css"), join(report, "link-inside"));
    await run({ base, report, index: join(report, "index.html") });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const status = async (registry: LocalDocRegistry, token: string, path: string) =>
  (await registry.read(token, path)).status;

test("register mints a 192-bit token; the document, siblings and nested files are served", () =>
  withFixture(async ({ base, index }) => {
    const registry = new LocalDocRegistry();
    const doc = await registry.register(index);
    assert.match(doc.token, LOCAL_DOC_TOKEN_PATTERN);
    assert.equal(Buffer.from(doc.token, "base64url").length, 24);
    assert.equal(doc.name, "index.html");

    const page = await registry.read(doc.token, "/index.html");
    assert.deepEqual([page.status, page.contentType], [200, "text/html; charset=utf-8"]);
    assert.equal(Buffer.from(page.body!).toString(), "<p>report/index.html</p>");
    for (const ok of ["", "/style.css", "/sub/%70age.html", "/link-inside"]) {
      assert.equal(await status(registry, doc.token, ok), 200, ok); // "" = the document itself
    }
    assert.notEqual((await registry.register(join(base, "outside.txt"))).token, doc.token);
  }));

test("traversal, absolute paths, symlinks, dotfiles and prefix siblings are 404", () =>
  withFixture(async ({ base, report, index }) => {
    const registry = new LocalDocRegistry();
    const { token } = await registry.register(index);
    const outside = join(base, "outside.txt");
    const attempts = [
      "/../outside.txt",
      "/sub/../../outside.txt",
      "/%2e%2e/outside.txt",
      "/..%2foutside.txt",
      `/${encodeURIComponent(outside)}`,
      "/style.css%00.png",
      "/%E0%A4%A", // malformed percent-encoding
      "/../report-secret/secret.txt", // sibling directory sharing the prefix
      "/link-dir/secret.txt", // symlinks planted in the document directory
      "/link-file",
      "/.env",
      "/sub/.hidden",
    ];
    for (const attempt of attempts)
      assert.equal(await status(registry, token, attempt), 404, attempt);
    assert.equal(await status(registry, token, "/style.css"), 200, "control: in-directory file");

    // A dot-named document can serve itself, and nothing else dotted.
    const draft = await registry.register(join(report, ".draft.html"));
    assert.equal(await status(registry, draft.token, "/.draft.html"), 200);
    assert.equal(await status(registry, draft.token, "/.env"), 404);
  }));

test("register rejects bad input and documents that escape their directory", () =>
  withFixture(async ({ base, report, index }) => {
    const registry = new LocalDocRegistry();
    const cases: [unknown, number][] = [
      [undefined, 400],
      ["report/index.html", 400], // relative
      [`${index}\0.png`, 400],
      [join(report, "missing.html"), 404],
      [join(base, "no-such-dir", "x.html"), 404],
      [report, 400], // a directory
      [join(report, "link-file"), 400], // symlinked out of its own directory
      [join(report, "link-inside"), 200],
    ];
    for (const [value, expected] of cases) {
      const got = await registry.register(value).then(
        () => 200,
        (err) => (assert.ok(err instanceof LocalDocError), err.status)
      );
      assert.equal(got, expected, String(value));
    }
  }));

test("tokens: unknown 404, idle expiry slides, LRU bound, clear", () =>
  withFixture(async ({ base, report, index }) => {
    let now = 0;
    const registry = new LocalDocRegistry({ ttlMs: 1000, maxEntries: 2, now: () => now });
    for (const token of ["", "short", "A".repeat(32), "x".repeat(33)]) {
      assert.equal(await status(registry, token, "/index.html"), 404, token);
    }

    const a = await registry.register(index); // expires at 1000
    now = 900;
    assert.equal(await status(registry, a.token, "/style.css"), 200); // a read slides it to 1900
    now = 1800;
    assert.equal(await status(registry, a.token, "/style.css"), 200); // ...and to 2800
    now = 2801;
    assert.equal(await status(registry, a.token, "/style.css"), 404);

    now = 3000;
    const x = await registry.register(index);
    now = 3001;
    const y = await registry.register(join(report, "style.css"));
    now = 3002;
    await registry.read(x.token, "/index.html"); // x is now newer than y
    now = 3003;
    const z = await registry.register(join(base, "outside.txt")); // at the bound: evicts y
    assert.equal(await status(registry, y.token, "/style.css"), 404);
    assert.equal(await status(registry, x.token, "/index.html"), 200);

    registry.clear();
    assert.equal(await status(registry, z.token, "/outside.txt"), 404);
  }));
