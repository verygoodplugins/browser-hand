/**
 * Real relay, real HTTP, real files. Covers the P1/P2 review findings on #30: a
 * local document must not read outside its directory or reach the relay API,
 * and must still resolve its own relative resources.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { serveRelay, type RelayServer } from "./relay.ts";
// The CLI's own registration path, so the whole file: -> served-URL flow is covered.
import { rewriteLocalFileUrl } from "../../cli-js/src/tool.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** GET with the path sent verbatim: fetch() would normalize `..` away before the server saw it. */
const raw = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject).end();
  });

/** WebSocket upgrade attempt; resolves with the status (101 = accepted). */
const upgrade = (port: number, path: string, origin?: string) =>
  new Promise<number>((resolve, reject) => {
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
      ...(origin ? { Origin: origin } : {}),
    };
    http
      .request({ host: "127.0.0.1", port, path, headers })
      .on("upgrade", (_res, socket) => (socket.destroy(), resolve(101)))
      .on("response", (res) => (res.resume(), resolve(res.statusCode ?? 0)))
      .on("error", reject)
      .end();
  });

const postDoc = (relayOrigin: string, path: string, headers: Record<string, string> = {}) =>
  fetch(`${relayOrigin}/local-docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ path }),
  });

describe("local documents through the relay", () => {
  let base: string;
  let relay: RelayServer;
  let relayOrigin: string;
  let relayPort: number;
  let docPort: number;
  let indexPath: string;
  let doc: { token: string; url: string; origin: string };
  const register = (path: string, headers?: Record<string, string>) =>
    postDoc(relayOrigin, path, headers);

  before(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "bh-localfile-e2e-")));
    for (const dir of ["report/img", "report/sub", "report-secret"]) {
      await mkdir(join(base, dir), { recursive: true });
    }
    const files: Record<string, string | Buffer> = {
      "report/index.html": `<link rel="stylesheet" href="./style.css"><script src="app.js"></script><img src="img/a.png">`,
      "report/style.css": "body{color:red}",
      "report/app.js": "window.__loaded = true;",
      "report/img/a.png": PNG,
      "report/sub/page.html": `<link rel="stylesheet" href="../style.css">`,
      "report/.env": "API_KEY=hunter2",
      "report-secret/creds.txt": "TOP-SECRET",
      "outside.txt": "outside the report directory",
    };
    for (const [file, content] of Object.entries(files)) await writeFile(join(base, file), content);
    await symlink(join(base, "report-secret"), join(base, "report", "leak"));
    indexPath = join(base, "report", "index.html");

    relayPort = await freePort();
    relayOrigin = `http://127.0.0.1:${relayPort}`;
    relay = await serveRelay({ port: relayPort, host: "127.0.0.1" });
    docPort = Number(new URL(relay.localDocOrigin).port);
    doc = await (await register(indexPath)).json();
  });

  after(async () => {
    await relay.stop();
    await rm(base, { recursive: true, force: true });
  });

  test("local pages are served from a different origin than the relay API, hardened", async () => {
    assert.notEqual(docPort, relayPort);
    assert.equal(doc.origin, relay.localDocOrigin);
    assert.match(doc.url, new RegExp(`^${doc.origin}/local/[A-Za-z0-9_-]{32}/index\\.html$`));

    const res = await fetch(doc.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(res.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal([...res.headers.keys()].filter((h) => h.startsWith("access-control-")).length, 0);
  });

  test("relative CSS, JS, image and nested-page resources load (P2)", async () => {
    const at = (rel: string, from = doc.url) => fetch(new URL(rel, from));
    const css = await at("./style.css");
    assert.deepEqual(
      [css.status, css.headers.get("content-type")],
      [200, "text/css; charset=utf-8"]
    );
    assert.equal(await css.text(), "body{color:red}");
    assert.equal((await at("app.js")).status, 200);
    const png = await at("img/a.png");
    assert.deepEqual([png.status, png.headers.get("content-type")], [200, "image/png"]);
    assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG);
    const sub = new URL("sub/page.html", doc.url).href;
    assert.equal((await at("../style.css", sub)).status, 200); // `../` within the directory
  });

  test("a document cannot read outside its directory (P1 regression)", async () => {
    const root = `/local/${doc.token}`;
    const outside = join(base, "outside.txt");
    const attempts = [
      `${root}/../outside.txt`,
      `${root}/%2e%2e/outside.txt`,
      `${root}/..%2foutside.txt`,
      `${root}/${encodeURIComponent(outside)}`,
      `${root}/../report-secret/creds.txt`, // sibling directory sharing the prefix
      `${root}/leak/creds.txt`, // symlink planted in the document directory
      `${root}/.env`, // dotfile next to the document
    ];
    for (const path of attempts) {
      const res = await raw(docPort, path);
      assert.equal(res.status, 404, path);
      assert.doesNotMatch(res.body, /hunter2|TOP-SECRET|outside the report/, path);
    }
  });

  test("no endpoint accepts a raw filesystem path; unknown tokens are 404", async () => {
    const secret = encodeURIComponent(join(base, "outside.txt"));
    for (const port of [relayPort, docPort]) {
      assert.equal((await raw(port, `/local-file?path=${secret}`)).status, 404);
    }
    assert.equal((await raw(docPort, join(base, "outside.txt"))).status, 404);
    for (const token of ["A".repeat(32), "short", "..", "%2e%2e"]) {
      assert.equal((await raw(docPort, `/local/${token}/index.html`)).status, 404, token);
    }
  });

  test("the document origin cannot reach the relay API, /cdp or /extension", async () => {
    const origin = relay.localDocOrigin;
    for (const path of ["/", "/pages", "/pages/x", "/cdp", "/extension", "/local-docs"]) {
      assert.equal((await raw(docPort, path)).status, 404, `${path} on the doc listener`);
    }
    // What a document would send (Origin = doc origin), or aim at the doc authority, is refused.
    for (const path of ["/", "/pages", "/pages/x", "/local-docs/x"]) {
      assert.equal((await raw(relayPort, path, { Origin: origin })).status, 403, path);
    }
    for (const host of [`127.0.0.1:${docPort}`, `localhost:${docPort}`]) {
      assert.equal((await raw(relayPort, "/pages", { Host: host })).status, 403, host);
    }
    for (const path of ["/cdp", "/extension"]) {
      assert.equal(await upgrade(relayPort, path, origin), 403, path);
    }

    // Controls: the CLI (no doc Origin/Host) and unrelated origins are unaffected.
    assert.equal(await upgrade(relayPort, "/cdp"), 101);
    assert.equal((await raw(relayPort, "/pages")).status, 200);
    assert.equal((await raw(relayPort, "/", { Origin: "http://localhost:3000" })).status, 200);
  });

  test("registration is CLI-only and validates input", async () => {
    for (const origin of [relay.localDocOrigin, "http://evil.example"]) {
      assert.equal((await register(indexPath, { Origin: origin })).status, 403, origin);
    }
    assert.equal((await register(indexPath, { "Content-Type": "text/plain" })).status, 415);
    for (const [path, expected] of [
      ["report/index.html", 400],
      [join(base, "report", "nope.html"), 404],
    ] as const) {
      const res = await register(path);
      assert.equal(res.status, expected, path);
      assert.ok(!(await res.text()).includes(base), "errors do not echo filesystem paths");
    }
  });

  test("CLI flow: file: URL in, capability URL out, query and hash preserved", async () => {
    const fileUrl = `${pathToFileURL(indexPath).href}?tab=2&q=a%20b#section-3`;
    const out = await rewriteLocalFileUrl(fileUrl, relayOrigin);
    const parsed = new URL(out);
    assert.equal(parsed.origin, relay.localDocOrigin);
    assert.match(parsed.pathname, /^\/local\/[A-Za-z0-9_-]{32}\/index\.html$/);
    assert.deepEqual([parsed.search, parsed.hash], ["?tab=2&q=a%20b", "#section-3"]);
    assert.equal((await fetch(new URL("style.css", out))).status, 200);
  });
});

test("an expired capability is 404 over HTTP; localDocPort must differ from the relay port", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bh-localfile-ttl-")));
  const port = await freePort();
  const relay = await serveRelay({ port, host: "127.0.0.1", localDocTtlMs: 150 });
  try {
    await writeFile(join(dir, "a.html"), "<p>a</p>");
    const { url } = await (await postDoc(`http://127.0.0.1:${port}`, join(dir, "a.html"))).json();
    assert.equal((await fetch(url)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await fetch(url)).status, 404, "expired token");
  } finally {
    await relay.stop();
    await rm(dir, { recursive: true, force: true });
  }
  await assert.rejects(serveRelay({ port, host: "127.0.0.1", localDocPort: port }), /must differ/);
});
