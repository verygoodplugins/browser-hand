/**
 * browser-hand relay — WebSocket bridge between the Chrome extension
 * (ws://HOST:PORT/extension) and CDP clients (ws://HOST:PORT/cdp).
 */
import { serveRelay } from "./relay.js";

const host = (process.env.HOST || process.env.DEV_BROWSER_RELAY_HOST || "127.0.0.1").trim();
const port = Number(process.env.PORT || process.env.DEV_BROWSER_RELAY_PORT || 9333);

let server: Awaited<ReturnType<typeof serveRelay>>;
try {
  server = await serveRelay({ host, port });
} catch (err) {
  // Misconfiguration (e.g. a non-loopback HOST): say why, no stack trace.
  console.error(`[browser-hand-relay] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
console.error(`[browser-hand-relay] listening on http://${host}:${port}`);
console.error(`[browser-hand-relay] extension: ws://${host}:${port}/extension`);
console.error(`[browser-hand-relay] cdp:       ${server.wsEndpoint}`);
console.error(`[browser-hand-relay] local docs: ${server.localDocOrigin} (capability URLs only)`);

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
