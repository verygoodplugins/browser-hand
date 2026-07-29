/**
 * ConnectionManager - Manages WebSocket connection to relay server.
 */

import type { Logger } from "../utils/logger";
import type { ExtensionCommandMessage, ExtensionResponseMessage } from "../utils/types";

const RELAY_HTTP_URL = "http://127.0.0.1:9333";
const RELAY_URL = "ws://127.0.0.1:9333/extension";
const RECONNECT_INTERVAL = 3000;
// Send a WebSocket message at least this often while connected. Chrome 116+
// resets the MV3 service-worker idle timer on WebSocket activity, so a sub-30s
// heartbeat keeps the worker (and thus the relay link) alive without a manual
// toolbar click. The relay ignores unknown methods, so it's a server-side no-op.
const HEARTBEAT_INTERVAL = 20000;

export interface ConnectionManagerDeps {
  logger: Logger;
  onMessage: (message: ExtensionCommandMessage) => Promise<unknown>;
  onConnect?: () => Promise<void>;
  onDisconnect: () => void;
}

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shouldMaintain = false;
  private connecting = false;
  private logger: Logger;
  private onMessage: (message: ExtensionCommandMessage) => Promise<unknown>;
  private onConnect?: () => Promise<void>;
  private onDisconnect: () => void;

  constructor(deps: ConnectionManagerDeps) {
    this.logger = deps.logger;
    this.onMessage = deps.onMessage;
    this.onConnect = deps.onConnect;
    this.onDisconnect = deps.onDisconnect;
  }

  /**
   * Check if WebSocket is open (may be stale if server crashed).
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Whether auto-reconnect is currently engaged. Used by the background
   * keepalive alarm to avoid kicking off a second connect attempt.
   */
  isMaintaining(): boolean {
    return this.shouldMaintain;
  }

  /**
   * Validate connection by checking if server is reachable.
   * More reliable than isConnected() as it detects server crashes.
   */
  async checkConnection(): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }

    // Verify server is actually reachable
    try {
      const response = await fetch(RELAY_HTTP_URL, {
        method: "GET",
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      // Server unreachable - close stale socket
      if (this.ws) {
        this.ws.close();
        this.ws = null;
        this.onDisconnect();
        this.scheduleReconnect();
      }
      return false;
    }
  }

  /**
   * Send a message to the relay server.
   */
  send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.debug("Error sending message:", error);
      }
    }
  }

  /**
   * Start maintaining connection (auto-reconnect).
   */
  startMaintaining(): void {
    this.shouldMaintain = true;
    void this.tryConnect()
      .catch(() => {})
      .finally(() => this.scheduleReconnect());
  }

  /**
   * Stop connection maintenance.
   */
  stopMaintaining(): void {
    this.shouldMaintain = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Disconnect from relay and stop maintaining connection.
   */
  disconnect(): void {
    this.stopMaintaining();
    const socket = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (socket) {
      socket.close();
    }
    this.onDisconnect();
  }

  /**
   * Ensure connection is established, waiting if needed.
   */
  async ensureConnected(): Promise<void> {
    if (this.isConnected()) return;

    await this.tryConnect();

    if (!this.isConnected()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.tryConnect();
    }

    if (!this.isConnected()) {
      throw new Error("Could not connect to relay server");
    }
  }

  /**
   * Try to connect to relay server once.
   */
  private async tryConnect(): Promise<void> {
    if (this.isConnected() || this.connecting) return;
    this.connecting = true;

    try {
      // Check if server is available
      try {
        await fetch(RELAY_HTTP_URL, { method: "GET" });
      } catch {
        return;
      }

      this.logger.debug("Connecting to relay server...");
      const socket = new WebSocket(RELAY_URL);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 5000);

        socket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        };

        socket.onclose = (event) => {
          clearTimeout(timeout);
          reject(new Error(`WebSocket closed: ${event.reason || event.code}`));
        };
      });

      this.ws = socket;
      this.setupSocketHandlers(socket);
      this.startHeartbeat(socket);
      this.logger.log("Connected to relay server");
      try {
        await this.onConnect?.();
      } catch (error) {
        this.logger.debug("Error after relay connect:", error);
      }
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Retry only while no live socket is present. The previous implementation
   * restarted this loop on every timer tick and let a superseded socket's
   * close handler clear the replacement socket, producing an endless
   * "Extension connection replaced" cycle in the relay.
   */
  private scheduleReconnect(): void {
    if (
      !this.shouldMaintain ||
      this.isConnected() ||
      this.connecting ||
      this.reconnectTimer
    ) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryConnect()
        .catch(() => {})
        .finally(() => this.scheduleReconnect());
    }, RECONNECT_INTERVAL);
  }

  /**
   * Start the WebSocket heartbeat that keeps the MV3 service worker alive.
   * Restarted on every (re)connect; stops itself if the socket is gone.
   */
  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws === socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ method: "keepalive" }));
        } catch (error) {
          this.logger.debug("Error sending heartbeat:", error);
        }
      } else {
        this.stopHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Set up WebSocket event handlers.
   */
  private setupSocketHandlers(socket: WebSocket): void {
    socket.onmessage = async (event: MessageEvent) => {
      let message: ExtensionCommandMessage;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        this.logger.debug("Error parsing message:", error);
        this.send({
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }

      const response: ExtensionResponseMessage = { id: message.id };
      try {
        response.result = await this.onMessage(message);
      } catch (error) {
        this.logger.debug("Error handling command:", error);
        response.error = (error as Error).message;
      }
      this.send(response);
    };

    socket.onclose = (event: CloseEvent) => {
      this.logger.debug("Connection closed:", event.code, event.reason);
      // A replacement socket may already be live by the time Chrome delivers
      // this close event. Never let a stale socket tear down that replacement.
      if (this.ws !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.ws = null;
      this.onDisconnect();
      this.scheduleReconnect();
    };

    socket.onerror = (event: Event) => {
      this.logger.debug("WebSocket error:", event);
    };
  }
}
