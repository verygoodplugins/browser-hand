/**
 * Codex P2 on #30: a browser without chrome.debugger (the "Search" fork) makes the
 * extension fall back to scripting, so the doctor's smoke tab opens fine and the
 * error doctor used to classify on never reaches it. The extension now reports the
 * limitation to the relay; this drives a fake extension through the real relay and
 * the real CLI doctor to prove `debugger_unavailable` is reported anyway.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { after, afterEach, before, describe, test } from "node:test";

import { serveRelay, type RelayServer } from "./relay.ts";

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const DEBUGGER_REASON = "debugger.attach isn't available in Search";

/**
 * Speaks the extension side of the relay protocol. Like the real TabManager, a
 * debugger-less browser only discovers the limitation inside createTarget's attach,
 * so it reports it there, before answering, and still hands back a working tab.
 */
async function connectExtension(
  port: number,
  { debuggerless, reportOnConnect = false }: { debuggerless: boolean; reportOnConnect?: boolean }
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  const send = (message: unknown) => ws.send(JSON.stringify(message));
  const report = { method: "register", params: { debugger: { available: false, reason: DEBUGGER_REASON } } };
  ws.addEventListener("message", (event) => {
    const { id, method, params } = JSON.parse(String(event.data));
    if (method !== "forwardCDPCommand") return;
    switch (params.method) {
      case "DevBrowser.listTargets":
        return send({
          id,
          result: {
            targetInfos: [
              { targetId: "t-open", type: "page", title: "Open", url: "https://example.com/" },
            ],
          },
        });
      case "Target.createTarget":
        if (debuggerless) send(report);
        send({
          method: "forwardCDPEvent",
          params: {
            method: "Target.attachedToTarget",
            params: {
              sessionId: "s-new",
              targetInfo: {
                targetId: "t-new",
                type: "page",
                title: "",
                url: params.params.url,
                attached: true,
              },
            },
          },
        });
        return send({ id, result: { targetId: "t-new" } });
      case "Target.closeTarget":
        return send({ id, result: { success: true } });
      default:
        return send({ id, result: {} });
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("extension socket failed")), { once: true });
  });
  const browser = { name: "Search", version: "1.0" };
  send({
    method: "register",
    params: { browser, ...(reportOnConnect ? { debugger: report.params.debugger } : {}) },
  });
  return ws;
}

describe("doctor reports debugger_unavailable through the relay", () => {
  let relay: RelayServer;
  let relayUrl: string;
  let doctor: () => Promise<Record<string, any>>;
  let extension: WebSocket | null = null;

  const info = async () => (await fetch(relayUrl)).json() as Promise<Record<string, any>>;
  const settled = async (ready: (i: Record<string, any>) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const current = await info();
      if (ready(current)) return current;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("relay never reached the expected state");
  };
  const disconnect = async () => {
    extension?.close();
    extension = null;
    await settled((i) => i.extensionConnected === false);
  };

  before(async () => {
    const port = await freePort();
    relayUrl = `http://127.0.0.1:${port}`;
    // The CLI reads its relay address from the environment at import time.
    process.env.DEV_BROWSER_RELAY_HOST = "127.0.0.1";
    process.env.DEV_BROWSER_RELAY_PORT = String(port);
    const { default: tool } = await import("../../cli-js/src/tool.js");
    doctor = () => tool.handler({ mode: "current", operation: "doctor" });
    relay = await serveRelay({ port, host: "127.0.0.1" });
  });

  afterEach(disconnect);
  after(() => relay.stop());

  test("smoke tab opens via the scripting fallback, yet status is debugger_unavailable (P2)", async () => {
    extension = await connectExtension(relay.port, { debuggerless: true });
    await settled((i) => i.extensionConnected && i.browser?.name === "Search");

    const result = await doctor();

    assert.equal(result.smoke.success, true, "the smoke tab bootstrapped");
    assert.equal(result.status, "debugger_unavailable");
    assert.deepEqual(result.debugger, { available: false, reason: DEBUGGER_REASON });
    assert.deepEqual(result.browser, { name: "Search", version: "1.0" });
    assert.match(result.action, /scripting transport/i);
    assert.equal(result.pathBNote, undefined, "not the separate-debug-profile case");
  });

  test("a browser whose debugger works stays tab_bootstrap_works", async () => {
    extension = await connectExtension(relay.port, { debuggerless: false });
    await settled((i) => i.extensionConnected && i.browser?.name === "Search");

    const result = await doctor();

    assert.equal(result.status, "tab_bootstrap_works");
    assert.equal(result.success, true);
    assert.equal(result.debugger, null);
  });

  test("the report belongs to one extension connection and is re-sent on reconnect", async () => {
    extension = await connectExtension(relay.port, { debuggerless: true, reportOnConnect: true });
    assert.deepEqual((await settled((i) => i.debugger !== null)).debugger, {
      available: false,
      reason: DEBUGGER_REASON,
    });

    await disconnect();
    assert.equal((await info()).debugger, null, "forgotten once the extension disconnects");

    extension = await connectExtension(relay.port, { debuggerless: false });
    await settled((i) => i.extensionConnected && i.browser !== null);
    assert.equal((await info()).debugger, null, "a fresh connection starts clean");
  });

  test("a malformed or available:true report does not flag the browser", async () => {
    extension = await connectExtension(relay.port, { debuggerless: false });
    await settled((i) => i.extensionConnected && i.browser !== null);
    for (const debuggerReport of [{ available: true }, "nope", null, {}]) {
      extension.send(JSON.stringify({ method: "register", params: { debugger: debuggerReport } }));
    }
    // register is handled in order; a later browser report proves the earlier ones ran.
    extension.send(JSON.stringify({ method: "register", params: { browser: { name: "Brave" } } }));
    await settled((i) => i.browser?.name === "Brave");
    assert.equal((await info()).debugger, null);
  });
});
