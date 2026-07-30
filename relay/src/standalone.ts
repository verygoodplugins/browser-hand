/**
 * browser-hand relay — WebSocket bridge between the Chrome extension
 * (ws://HOST:PORT/extension) and CDP clients (ws://HOST:PORT/cdp).
 */
import { serveRelay } from "./relay.js";

const host = (process.env.HOST || process.env.DEV_BROWSER_RELAY_HOST || "127.0.0.1").trim();
const port = Number(process.env.PORT || process.env.DEV_BROWSER_RELAY_PORT || 9333);

const server = await serveRelay({ host, port });
console.error(`[browser-hand-relay] listening on http://${host}:${port}`);
console.error(`[browser-hand-relay] extension: ws://${host}:${port}/extension`);
console.error(`[browser-hand-relay] cdp:       ${server.wsEndpoint}`);

const stop = async () => {
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

// Keep process alive
await new Promise(() => {});
