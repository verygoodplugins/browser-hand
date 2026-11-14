import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../services/ConnectionManager";

describe("ConnectionManager", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("connects without requiring a cross-origin HTTP probe", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("CORS"));
    vi.stubGlobal("fetch", fetch);
    class Socket {
      static OPEN = 1;
      readyState = Socket.OPEN;
      onopen?: () => void;
      onclose?: () => void;
      onerror?: () => void;
      onmessage?: () => void;
      constructor() { queueMicrotask(() => this.onopen?.()); }
      send() {}
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("WebSocket", Socket);
    const manager = new ConnectionManager({
      logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn() },
      onMessage: vi.fn(),
      onDisconnect: vi.fn(),
    });
    await manager.ensureConnected();
    expect(await manager.checkConnection()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    manager.disconnect();
  });

  it("keeps a replacement socket when the previous socket closes late", () => {
    const onDisconnect = vi.fn();
    const manager = new ConnectionManager({
      logger: {
        log: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      },
      onMessage: vi.fn(),
      onDisconnect,
    });
    const replacedSocket = {} as WebSocket;
    const activeSocket = {} as WebSocket;
    const internals = manager as unknown as {
      ws: WebSocket | null;
      setupSocketHandlers: (socket: WebSocket) => void;
    };

    internals.ws = replacedSocket;
    internals.setupSocketHandlers(replacedSocket);
    internals.ws = activeSocket;

    replacedSocket.onclose?.({
      code: 4001,
      reason: "Extension Replaced",
    } as CloseEvent);

    expect(internals.ws).toBe(activeSocket);
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
