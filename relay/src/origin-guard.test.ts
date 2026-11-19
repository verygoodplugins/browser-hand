/**
 * Real relay, real HTTP: a web page must not be able to reach the relay API,
 * /cdp or /extension, whether it comes in with its own Origin or through a
 * rebound DNS name (foreign Host). The CLI sends neither and must keep working.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import {
  assertSafeBind,
  chromeExtensionIdForPath,
  createOriginGuard,
  defaultChromeExtensionDir,
  generateChromeExtensionId,
  isAllowedOrigin,
  isLoopbackLiteral,
  resolveAllowedOrigins,
} from "./origin-guard.ts";
import { serveRelay, type RelayServer } from "./relay.ts";

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** HTTP status for a request sent to the relay with exactly these headers (Host defaults to the relay's). */
const status = (
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET"
) =>
  new Promise<number>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject).end();
  });

/** WebSocket upgrade attempt; resolves with the status (101 = accepted). */
const upgrade = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve, reject) => {
    http
      .request({
        host: "127.0.0.1",
        port,
        path,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
          ...headers,
        },
      })
      .on("upgrade", (_res, socket) => (socket.destroy(), resolve(101)))
      .on("response", (res) => (res.resume(), resolve(res.statusCode ?? 0)))
      .on("error", reject)
      .end();
  });

const OTHER_EXTENSION = `chrome-extension://${"a".repeat(32)}`;
const SAFARI_ORIGIN = "safari-web-extension://3F2B8C1E-5D4A-4E7B-9C0D-1A2B3C4D5E6F";

describe("relay origin and host guard, default policy", () => {
  let relay: RelayServer;
  let port: number;
  let pinned: string;

  before(async () => {
    port = await freePort();
    // An empty env: the developer's own BROWSER_HAND_* variables must not leak in.
    relay = await serveRelay({ port, host: "127.0.0.1", env: {} });
    pinned = `chrome-extension://${chromeExtensionIdForPath(defaultChromeExtensionDir())}`;
    assert.notEqual(pinned, OTHER_EXTENSION);
  });
  after(() => relay.stop());

  test("a web page origin is refused on the API and on both WebSocket routes", async () => {
    const origins = [
      "https://evil.example",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      `http://127.0.0.1:${port}`,
      "null",
    ];
    for (const origin of origins) {
      const headers = { Origin: origin };
      for (const path of ["/", "/pages", "/pages/x"]) {
        assert.equal(await status(port, path, headers), 403, `${origin} GET ${path}`);
      }
      assert.equal(await status(port, "/pages", { ...headers, "Content-Type": "text/plain" }, "POST"), 403, `${origin} POST`);
      assert.equal(await status(port, "/pages", headers, "OPTIONS"), 403, `${origin} preflight`);
      for (const path of ["/cdp", "/extension"]) {
        assert.equal(await upgrade(port, path, headers), 403, `${origin} upgrade ${path}`);
      }
    }
    // An empty Origin is not a value any browser sends. Over HTTP it is refused; on
    // a WebSocket upgrade @hono/node-ws drops empty header values, so it reads as
    // "no Origin", the same as the CLI.
    assert.equal(await status(port, "/", { Origin: "" }), 403);
  });

  test("another extension's origin is refused", async () => {
    for (const origin of [
      OTHER_EXTENSION,
      "moz-extension://3f2b8c1e-5d4a-4e7b-9c0d-1a2b3c4d5e6f",
      "safari-web-extension://", // no host
      "chrome-extension://",
    ]) {
      assert.equal(await status(port, "/", { Origin: origin }), 403, origin);
      for (const path of ["/cdp", "/extension"]) {
        assert.equal(await upgrade(port, path, { Origin: origin }), 403, `${origin} ${path}`);
      }
    }
  });

  test("the pinned Browser Hand extension origin and Safari are accepted", async () => {
    for (const origin of [pinned, pinned.toUpperCase().replace("CHROME-EXTENSION", "chrome-extension"), SAFARI_ORIGIN]) {
      assert.equal(await status(port, "/", { Origin: origin }), 200, origin);
      assert.equal(await upgrade(port, "/extension", { Origin: origin }), 101, `${origin} /extension`);
      assert.equal(await upgrade(port, "/cdp", { Origin: origin }), 101, `${origin} /cdp`);
    }
  });

  test("a foreign Host header is refused, with or without an Origin (DNS rebinding)", async () => {
    const foreign = [
      `evil.example:${port}`,
      "rebind.test",
      "127.0.0.1", // no port
      `127.0.0.1:${port + 1}`,
      `localhost.evil.example:${port}`,
      `127.0.0.1.evil.example:${port}`,
      `0.0.0.0:${port}`,
    ];
    for (const host of foreign) {
      for (const path of ["/", "/pages", "/pages/x"]) {
        assert.equal(await status(port, path, { Host: host }), 403, `${host} ${path}`);
      }
      for (const path of ["/cdp", "/extension"]) {
        assert.equal(await upgrade(port, path, { Host: host }), 403, `${host} ${path}`);
      }
    }
    // A rebound page that also sends its own Origin fails on both counts.
    assert.equal(await status(port, "/", { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` }), 403);
  });

  test("loopback Host names are accepted", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      assert.equal(await status(port, "/", { Host: host }), 200, host);
    }
  });

  test("clients that send no Origin (the CLI) are unaffected", async () => {
    assert.equal(await status(port, "/"), 200);
    assert.equal(await status(port, "/pages"), 200);
    assert.equal(await upgrade(port, "/cdp"), 101);
    assert.equal(await upgrade(port, "/extension"), 101);
  });
});

describe("BROWSER_HAND_ALLOWED_ORIGINS replaces the default allow-list", () => {
  let relay: RelayServer;
  let port: number;
  const mine = `chrome-extension://${"b".repeat(32)}`;
  const mySafari = "safari-web-extension://AAAAAAAA-0000-0000-0000-000000000000";

  before(async () => {
    port = await freePort();
    relay = await serveRelay({
      port,
      host: "127.0.0.1",
      env: { BROWSER_HAND_ALLOWED_ORIGINS: `${mine.toUpperCase().replace("CHROME-EXTENSION", "chrome-extension")}/, ${mySafari}\thttps://tools.example.test` },
    });
  });
  after(() => relay.stop());

  test("listed origins are accepted; the defaults are not", async () => {
    for (const origin of [mine, mySafari, "https://tools.example.test"]) {
      assert.equal(await status(port, "/", { Origin: origin }), 200, origin);
      assert.equal(await upgrade(port, "/cdp", { Origin: origin }), 101, origin);
    }
    for (const origin of [
      `chrome-extension://${chromeExtensionIdForPath(defaultChromeExtensionDir())}`,
      SAFARI_ORIGIN,
      "https://evil.example",
    ]) {
      assert.equal(await status(port, "/", { Origin: origin }), 403, origin);
    }
    assert.equal(await status(port, "/"), 200, "no Origin still allowed");
  });

  test("entries that are not origins fail startup instead of widening access", async () => {
    for (const entry of ["*", "http://*", "https://*", "evil.example", "chrome-extension://", "chrome-extension://a/b"]) {
      await assert.rejects(
        serveRelay({ port: await freePort(), host: "127.0.0.1", env: { BROWSER_HAND_ALLOWED_ORIGINS: entry } }),
        /BROWSER_HAND_ALLOWED_ORIGINS/,
        entry
      );
    }
  });

  test("a blank value keeps the defaults", () => {
    const defaults = resolveAllowedOrigins({});
    assert.deepEqual(resolveAllowedOrigins({ BROWSER_HAND_ALLOWED_ORIGINS: "  ," }), defaults);
    assert.ok(defaults.includes("safari-web-extension://*"));
    assert.ok(defaults.includes(`chrome-extension://${chromeExtensionIdForPath(defaultChromeExtensionDir())}`));
  });
});

describe("bind address", () => {
  test("loopback literals are accepted; anything else is not", () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "[::1]", "0:0:0:0:0:0:0:1"]) {
      assert.equal(isLoopbackLiteral(host), true, host);
    }
    for (const host of [
      "0.0.0.0",
      "::",
      "localhost",
      "192.168.1.5",
      "10.0.0.1",
      "128.0.0.1",
      "127.1",
      "127.0.0.1.evil.example",
      "::ffff:127.0.0.1",
      "fe80::1%lo0",
      "evil.example",
      "",
    ]) {
      assert.equal(isLoopbackLiteral(host), false, host);
    }
  });

  test("a non-loopback bind is refused before anything listens, unless BROWSER_HAND_ALLOW_REMOTE_BIND=1", async () => {
    for (const host of ["0.0.0.0", "::", "localhost", "192.168.1.5"]) {
      await assert.rejects(
        serveRelay({ port: await freePort(), host, env: {} }),
        /Refusing to bind.*BROWSER_HAND_ALLOW_REMOTE_BIND=1/,
        host
      );
      assert.throws(() => assertSafeBind(host, { BROWSER_HAND_ALLOW_REMOTE_BIND: "true" }), /Refusing to bind/, host);
      assert.throws(() => assertSafeBind(host, { BROWSER_HAND_ALLOW_REMOTE_BIND: "0" }), /Refusing to bind/, host);
      assert.doesNotThrow(() => assertSafeBind(host, { BROWSER_HAND_ALLOW_REMOTE_BIND: "1" }), host);
    }
    assert.doesNotThrow(() => assertSafeBind("127.0.0.1", {}));
  });
});

describe("origin guard internals", () => {
  test("extension ID derivation matches Chromium", async () => {
    // Chromium's own id_util_unittest: GenerateId("test").
    assert.equal(generateChromeExtensionId("test"), "jpignaibiiemhngfjkcpokkamffknabf");

    const base = await realpath(await mkdtemp(join(tmpdir(), "bh-origin-guard-")));
    try {
      await mkdir(join(base, "ext"));
      await symlink(join(base, "ext"), join(base, "link"));
      // Chromium hashes the realpath, so a symlinked load path yields the same ID.
      assert.equal(chromeExtensionIdForPath(join(base, "link")), generateChromeExtensionId(join(base, "ext")));
      // Not on disk yet: the absolute path is hashed as-is.
      const missing = join(base, "not-built-yet", "chrome-mv3");
      assert.equal(chromeExtensionIdForPath(missing), generateChromeExtensionId(missing));
      assert.match(chromeExtensionIdForPath(missing), /^[a-p]{32}$/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("scheme wildcards need a host and never cover web origins", () => {
    const rules = ["safari-web-extension://*", "chrome-extension://abc"];
    assert.equal(isAllowedOrigin("safari-web-extension://UUID-1", rules), true);
    assert.equal(isAllowedOrigin("Safari-Web-Extension://uuid-1", rules), true);
    for (const origin of ["safari-web-extension://", "safari-web-extension:///x", "safari-web-extension://a/b", "chrome-extension://abcd", "https://uuid-1"]) {
      assert.equal(isAllowedOrigin(origin, rules), false, origin);
    }
  });

  test("a rejection is logged once per distinct value, quoted and bounded", async () => {
    const messages: string[] = [];
    const guarded = new Hono();
    guarded.use("*", createOriginGuard({ port: 9333, bindHost: "127.0.0.1", allowedOrigins: [], onReject: (m) => messages.push(m) }));
    guarded.get("/", (c) => c.text("ok"));
    const call = (headers: Record<string, string>) => guarded.request("/", { headers: { host: "127.0.0.1:9333", ...headers } });

    for (let i = 0; i < 3; i++) assert.equal((await call({ origin: "https://evil.example" })).status, 403);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Origin "https:\/\/evil\.example".*BROWSER_HAND_ALLOWED_ORIGINS/);

    for (let i = 0; i < 100; i++) await call({ origin: `https://evil-${i}.example` });
    assert.ok(messages.length <= 20, "bounded");
    assert.equal((await call({})).status, 200, "no Origin passes");
  });
});
