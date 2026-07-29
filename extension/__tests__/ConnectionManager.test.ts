import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../services/ConnectionManager";

describe("ConnectionManager", () => {
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
