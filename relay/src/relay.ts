import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { WSContext } from "hono/ws";
import {
  isBlankPageUrl,
  pickExistingPageTarget,
  planBlankNavigation,
  type AdoptTarget,
} from "./adopt-existing-tab.js";
import {
  LOCAL_DOC_ROUTE_PREFIX,
  LOCAL_DOC_SECURITY_HEADERS,
  LocalDocError,
  LocalDocRegistry,
} from "./local-file.js";

/** Host browser reported by the extension on connect. */
export interface HostBrowser {
  name: string;
  version: string;
}

export interface RelayOptions {
  port?: number;
  host?: string;
  /** Port of the document listener (default: OS-assigned). Must differ from `port`: it is the origin boundary. */
  localDocPort?: number;
  /** Idle lifetime of a local-document capability token (default 2h, sliding). */
  localDocTtlMs?: number;
}

export interface RelayServer {
  wsEndpoint: string;
  port: number;
  /** Origin local documents are served from, e.g. http://127.0.0.1:41873. */
  localDocOrigin: string;
  stop(): Promise<void>;
}

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}

interface ConnectedTarget {
  sessionId: string;
  targetId: string;
  targetInfo: TargetInfo;
}

interface PlaywrightClient {
  id: string;
  ws: WSContext;
  knownTargets: Set<string>;
}

interface ExtensionResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
}

interface ExtensionEventMessage {
  method: "forwardCDPEvent";
  params: {
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
  };
}

type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionEventMessage
  | { method: "log"; params: { level: string; args: string[] } }
  | {
      method: "register";
      params: {
        browser?: Partial<HostBrowser>;
        debugger?: { available?: boolean; reason?: string };
      };
    };

interface CDPCommand {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface CDPResponse {
  id: number;
  sessionId?: string;
  result?: unknown;
  error?: { message: string };
}

interface CDPEvent {
  method: string;
  sessionId?: string;
  params?: Record<string, unknown>;
}

function adoptedNavigationEvents(
  sessionId: string | undefined,
  frameId: string,
  loaderId: string,
  url: string,
  stamp: number,
  loaded: boolean
): CDPEvent[] {
  const frame = {
    id: frameId,
    loaderId,
    url,
    mimeType: "text/html",
    securityOrigin: url,
  };
  const events: CDPEvent[] = [
    {
      method: "Page.frameNavigated",
      sessionId,
      params: { frame },
    },
    {
      method: "Page.domContentEventFired",
      sessionId,
      params: { timestamp: stamp },
    },
  ];
  if (!loaded) return events;
  events.push(
    {
      method: "Page.loadEventFired",
      sessionId,
      params: { timestamp: stamp },
    },
    {
      method: "Page.frameStoppedLoading",
      sessionId,
      params: { frameId },
    }
  );
  for (const name of ["DOMContentLoaded", "load", "networkIdle"]) {
    events.push({
      method: "Page.lifecycleEvent",
      sessionId,
      params: { frameId, loaderId, name, timestamp: stamp },
    });
  }
  return events;
}

/** `host` as it appears in a URL authority (IPv6 literals need brackets). */
function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export async function serveRelay(options: RelayOptions = {}): Promise<RelayServer> {
  const port = options.port ?? 9222;
  const host = options.host ?? "127.0.0.1";
  if (options.localDocPort !== undefined && options.localDocPort === port) {
    throw new Error("localDocPort must differ from the relay port (separate origins)");
  }

  const connectedTargets = new Map<string, ConnectedTarget>();
  /** Named page → last known session + target. Prefer targetId rebind when session churns. */
  const namedPages = new Map<string, { sessionId: string; targetId: string }>();
  /** Blank tab a client opened, rewritten onto the already-open page. */
  const adoptedBlanks = new Map<
    string,
    {
      clientSessionId: string;
      clientTargetId: string;
      liveSessionId: string;
      liveTargetId: string;
      ownerClientId?: string;
    }
  >();
  const adoptedByTarget = new Map<string, { clientSessionId: string; liveTargetId: string }>();
  const quietDetach = new Set<string>();
  const lastFrameId = new Map<string, string>();
  /** Target ids handed back from createTarget/open that already belonged to the user. */
  const protectedTargetIds = new Set<string>();
  /** Tabs this relay created. Blank adoption may close these, not a user's existing blank. */
  const relayCreatedTargetIds = new Set<string>();
  const playwrightClients = new Map<string, PlaywrightClient>();
  let extensionWs: WSContext | null = null;
  /** Browser the connected extension is running in (null until it registers). */
  let extensionBrowser: HostBrowser | null = null;
  /**
   * Set once the extension reports its browser has no chrome.debugger. The extension
   * falls back to scripting and the failing call then succeeds, so this report is the
   * only way doctor learns the limitation. Null = none reported on this connection.
   */
  let extensionDebugger: { available: false; reason: string } | null = null;

  const deferredCdpEvents: CDPEvent[] = [];

  function clearAdoptionState(): void {
    adoptedBlanks.clear();
    adoptedByTarget.clear();
    quietDetach.clear();
    lastFrameId.clear();
    protectedTargetIds.clear();
    relayCreatedTargetIds.clear();
  }

  /**
   * True only for tabs this relay opened that no one adopted as an existing
   * page. `browser-hand close` closes these without an override; everything
   * else is a tab the user may have had open.
   */
  function isBrowserHandOwned(targetId: unknown): boolean {
    return (
      typeof targetId === "string" &&
      relayCreatedTargetIds.has(targetId) &&
      !protectedTargetIds.has(targetId)
    );
  }

  function listedTargets(): AdoptTarget[] {
    return Array.from(connectedTargets.values()).map((target) => {
      const info = target.targetInfo as TargetInfo & { focused?: boolean; active?: boolean };
      return {
        targetId: target.targetId,
        sessionId: target.sessionId,
        url: info.url,
        type: info.type,
        focused: info.focused === true,
        active: info.active === true,
      };
    });
  }

  function findTargetById(targetId: string): ConnectedTarget | undefined {
    for (const target of connectedTargets.values()) {
      if (target.targetId === targetId) return target;
    }
    return undefined;
  }

  function resolveNamedPage(name: string): ConnectedTarget | undefined {
    const entry = namedPages.get(name);
    if (!entry) return undefined;

    let target = (entry.sessionId && connectedTargets.get(entry.sessionId)) || undefined;
    if (!target && entry.targetId) {
      target = findTargetById(entry.targetId);
    }
    if (target) {
      // Keep mapping current if session was re-keyed after attach churn
      namedPages.set(name, {
        sessionId: target.sessionId,
        targetId: target.targetId,
      });
    }
    return target;
  }

  const extensionPendingRequests = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  let extensionMessageId = 0;

  function log(...args: unknown[]) {
    console.error("[relay]", ...args);
  }

  function sendToPlaywright(message: CDPResponse | CDPEvent, clientId?: string) {
    const messageStr = JSON.stringify(message);

    if (clientId) {
      const client = playwrightClients.get(clientId);
      if (client) {
        client.ws.send(messageStr);
      }
      return;
    }

    for (const client of playwrightClients.values()) {
      client.ws.send(messageStr);
    }
  }

  function sendAttachedToTarget(
    target: ConnectedTarget,
    clientId?: string,
    waitingForDebugger = false
  ) {
    const event: CDPEvent = {
      method: "Target.attachedToTarget",
      params: {
        sessionId: target.sessionId,
        targetInfo: { ...target.targetInfo, attached: true },
        waitingForDebugger,
      },
    };

    if (clientId) {
      const client = playwrightClients.get(clientId);
      if (client && !client.knownTargets.has(target.targetId)) {
        client.knownTargets.add(target.targetId);
        client.ws.send(JSON.stringify(event));
      }
      return;
    }

    for (const client of playwrightClients.values()) {
      if (!client.knownTargets.has(target.targetId)) {
        client.knownTargets.add(target.targetId);
        client.ws.send(JSON.stringify(event));
      }
    }
  }

  async function sendToExtension({
    method,
    params,
    timeout = 30000,
  }: {
    method: string;
    params?: Record<string, unknown>;
    timeout?: number;
  }): Promise<unknown> {
    if (!extensionWs) {
      throw new Error("Extension not connected");
    }

    const id = ++extensionMessageId;
    const message = { id, method, params };

    extensionWs.send(JSON.stringify(message));

    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        extensionPendingRequests.delete(id);
        reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`));
      }, timeout);

      extensionPendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
    });
  }

  async function routeCdpCommand({
    method,
    params,
    sessionId,
    clientId,
  }: {
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
    clientId?: string;
  }): Promise<unknown> {
    const clientSessionId = sessionId;
    const clientTarget = clientSessionId ? connectedTargets.get(clientSessionId) : undefined;
    if (
      method === "Page.navigate" &&
      clientTarget &&
      isBlankPageUrl(clientTarget.targetInfo.url) &&
      !adoptedBlanks.has(clientSessionId || "")
    ) {
      const plan = planBlankNavigation({
        currentUrl: clientTarget.targetInfo.url,
        currentTargetId: clientTarget.targetId,
        navigateUrl: typeof params?.url === "string" ? params.url : "",
        targets: listedTargets(),
      });
      if (
        plan.action === "adopt" &&
        plan.target.sessionId &&
        plan.target.targetId &&
        relayCreatedTargetIds.has(clientTarget.targetId)
      ) {
        const liveSessionId = plan.target.sessionId;
        const liveTargetId = plan.target.targetId;
        adoptedBlanks.set(clientTarget.sessionId, {
          clientSessionId: clientTarget.sessionId,
          clientTargetId: clientTarget.targetId,
          liveSessionId,
          liveTargetId,
          ownerClientId: clientId,
        });
        adoptedByTarget.set(clientTarget.targetId, {
          clientSessionId: clientTarget.sessionId,
          liveTargetId,
        });
        protectedTargetIds.add(liveTargetId);
        for (const [name, entry] of namedPages) {
          if (
            entry.targetId === clientTarget.targetId ||
            entry.sessionId === clientTarget.sessionId
          ) {
            namedPages.set(name, { sessionId: liveSessionId, targetId: liveTargetId });
          }
        }
        quietDetach.add(clientTarget.sessionId);
        await sendToExtension({
          method: "forwardCDPCommand",
          params: {
            method: "Target.closeTarget",
            params: { targetId: clientTarget.targetId },
          },
        }).catch((err) => log("failed to close blank tab adopted onto an existing page", err));
        const frameId = lastFrameId.get(clientTarget.sessionId) || clientTarget.targetId;
        const loaderId = `adopted-${liveTargetId}`;
        const url = plan.target.url || (typeof params?.url === "string" ? params.url : "");
        const stamp = Date.now() / 1000;
        let loaded = false;
        try {
          const evaluated = (await sendToExtension({
            method: "forwardCDPCommand",
            params: {
              method: "Runtime.evaluate",
              params: { expression: "document.readyState", returnByValue: true },
              sessionId: liveSessionId,
            },
          })) as { result?: { value?: string } };
          loaded = evaluated?.result?.value === "complete";
        } catch {
          loaded = false;
        }
        deferredCdpEvents.push(
          ...adoptedNavigationEvents(clientSessionId, frameId, loaderId, url, stamp, loaded)
        );
        log(`Adopted blank ${clientTarget.targetId} onto existing tab ${liveTargetId}`);
        return { frameId, loaderId, isDownload: false };
      }
    }

    const adopted = clientSessionId ? adoptedBlanks.get(clientSessionId) : undefined;
    if (method === "Page.close" && adopted) {
      log(`Ignoring Page.close for adopted session ${clientSessionId}`);
      return {};
    }
    if (adopted) {
      if (adopted.ownerClientId && clientId && adopted.ownerClientId !== clientId) {
        throw new Error(`Session ${clientSessionId} is not owned by this client`);
      }
      sessionId = adopted.liveSessionId;
    }
    if (method === "Target.closeTarget") {
      const closingId = typeof params?.targetId === "string" ? params.targetId : "";
      // `force` is the CLI's `--include-user-tabs`: the caller already decided to
      // close a tab the user had open. Playwright never sends it.
      const forced = params?.force === true;
      if (
        closingId &&
        ((protectedTargetIds.has(closingId) && !forced) || adoptedByTarget.has(closingId))
      ) {
        log(`Ignoring close of adopted tab ${closingId}`);
        return { success: true };
      }
    } else if (params && typeof params.targetId === "string") {
      const mapped = adoptedByTarget.get(params.targetId);
      if (mapped) {
        params = { ...params, targetId: mapped.liveTargetId };
      }
    }

    switch (method) {
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: "Chrome/Extension-Bridge",
          revision: "1.0.0",
          userAgent: "dev-browser-relay/1.0.0",
          jsVersion: "V8",
        };

      case "Browser.setDownloadBehavior":
        return {};

      case "Target.setAutoAttach":
        if (sessionId) break;
        return {};

      case "Target.setDiscoverTargets":
        return {};

      case "Target.attachToBrowserTarget":
        return { sessionId: "browser" };

      case "Target.detachFromTarget":
        if (sessionId === "browser" || params?.sessionId === "browser") {
          return {};
        }
        break;

      case "Target.attachToTarget": {
        const targetId = params?.targetId as string;
        if (!targetId) {
          throw new Error("targetId is required for Target.attachToTarget");
        }

        const adoptedTarget = adoptedByTarget.get(targetId);
        if (adoptedTarget) {
          return { sessionId: adoptedTarget.clientSessionId };
        }

        for (const target of connectedTargets.values()) {
          if (target.targetId === targetId) {
            return { sessionId: target.sessionId };
          }
        }

        throw new Error(`Target ${targetId} not found in connected targets`);
      }

      case "Target.getTargetInfo": {
        const targetId = params?.targetId as string;

        if (targetId) {
          for (const target of connectedTargets.values()) {
            if (target.targetId === targetId) {
              return { targetInfo: target.targetInfo };
            }
          }
        }

        if (sessionId) {
          const target = connectedTargets.get(sessionId);
          if (target) {
            return { targetInfo: target.targetInfo };
          }
        }

        const firstTarget = Array.from(connectedTargets.values())[0];
        return { targetInfo: firstTarget?.targetInfo };
      }

      case "Target.getTargets": {
        try {
          const live = (await sendToExtension({
            method: "forwardCDPCommand",
            params: { method: "DevBrowser.listTargets" },
            timeout: 2000,
          })) as { targetInfos?: Array<Record<string, unknown>> } | undefined;
          if (Array.isArray(live?.targetInfos)) {
            return {
              targetInfos: live.targetInfos.map((targetInfo) => ({
                ...targetInfo,
                attached: true,
                browserHandOwned: isBrowserHandOwned(targetInfo.targetId),
              })),
            };
          }
        } catch (err) {
          log("live listTargets failed; using cached targets", err);
        }
        return {
          targetInfos: Array.from(connectedTargets.values()).map((t) => ({
            ...t.targetInfo,
            attached: true,
            browserHandOwned: isBrowserHandOwned(t.targetId),
          })),
        };
      }

      case "Target.createTarget": {
        const url = typeof params?.url === "string" ? params.url : "";
        if (url && !isBlankPageUrl(url)) {
          const existing = pickExistingPageTarget(listedTargets(), url);
          if (existing) {
            protectedTargetIds.add(existing.targetId);
            log(`Target.createTarget reused ${existing.targetId} for ${url}`);
            return { targetId: existing.targetId };
          }
        }
        const created = (await sendToExtension({
          method: "forwardCDPCommand",
          params: { method, params },
        })) as { targetId?: string };
        if (created?.targetId) relayCreatedTargetIds.add(created.targetId);
        return created;
      }

      case "Target.closeTarget":
        return await sendToExtension({
          method: "forwardCDPCommand",
          params: { method, params },
        });
    }

    return await sendToExtension({
      method: "forwardCDPCommand",
      params: { sessionId, method, params },
    });
  }

  // Local documents get their own listener: origins include the port, so a
  // document is never same-origin with the relay API, and this listener has no
  // route except /local/<token>/…. It starts first so the control guard knows its port.
  const localDocs = new LocalDocRegistry({ ttlMs: options.localDocTtlMs });
  const docApp = new Hono();
  let docAuthorities = new Set<string>();
  const isDocAuthority = (authority: string | undefined): boolean =>
    authority !== undefined && docAuthorities.has(authority.toLowerCase());

  docApp.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(LOCAL_DOC_SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
  });
  docApp.get("*", async (c) => {
    if (!isDocAuthority(c.req.header("host"))) return c.notFound();
    const match = /^\/local\/([^/]+)(\/.*)?$/.exec(new URL(c.req.url).pathname);
    if (!match) return c.notFound();
    const result = await localDocs.read(match[1], match[2] ?? "");
    if (result.status !== 200 || !result.body) return c.notFound();
    return new Response(result.body, {
      status: 200,
      headers: { "content-type": result.contentType || "application/octet-stream" },
    });
  });

  let docServer!: ServerType;
  const docPort = await new Promise<number>((resolve, reject) => {
    docServer = serve(
      { fetch: docApp.fetch, port: options.localDocPort ?? 0, hostname: host },
      (info) => resolve(info.port)
    );
    docServer.once("error", reject);
  });
  const docHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : urlHost(host);
  const localDocOrigin = `http://${docHost}:${docPort}`;
  docAuthorities = new Set(
    [docHost, "127.0.0.1", "localhost", "[::1]"].map((h) => `${h}:${docPort}`.toLowerCase())
  );

  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // Nothing addressed to or issued by the document origin may reach the relay
  // API, /cdp or /extension: reject by Host and by Origin before any route runs.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    let fromDocument = false;
    if (origin) {
      try {
        fromDocument = isDocAuthority(new URL(origin).host);
      } catch {
        // Opaque or malformed Origin ("null"): not the document origin.
      }
    }
    if (fromDocument || isDocAuthority(c.req.header("host"))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });

  app.get("/", (c) => {
    return c.json({
      wsEndpoint: `ws://${host}:${port}/cdp`,
      extensionConnected: extensionWs !== null,
      // Which browser the extension is driving. Agents read this so they target
      // the connected browser instead of assuming Chrome.
      browser: extensionBrowser,
      // { available: false, reason } when the browser restricts chrome.debugger.
      debugger: extensionDebugger,
      mode: "extension",
    });
  });

  // Register a local document (file: URLs fail in chrome.tabs.create) and return
  // its capability URL. The only route taking a filesystem path, so CLI-only:
  // browsers attach Origin to every POST and a JSON body forces a preflight the
  // relay never answers, so a web page can neither call it nor read the token.
  app.post("/local-docs", async (c) => {
    if (c.req.header("origin") !== undefined) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: "Content-Type must be application/json" }, 415);
    }
    let body: { path?: unknown } | null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      const doc = await localDocs.register(body?.path);
      return c.json(
        {
          token: doc.token,
          name: doc.name,
          expiresAt: doc.expiresAt,
          origin: localDocOrigin,
          url: `${localDocOrigin}${LOCAL_DOC_ROUTE_PREFIX}${doc.token}/${encodeURIComponent(doc.name)}`,
        },
        201
      );
    } catch (err) {
      if (err instanceof LocalDocError) {
        return c.json({ error: err.message }, err.status as 400 | 404);
      }
      throw err;
    }
  });

  app.get("/pages", (c) => {
    return c.json({
      pages: Array.from(namedPages.keys()),
    });
  });

  // Attach-only client operations must be able to resolve a name without
  // invoking the create-or-get endpoint below. A missing name is an ordinary
  // lookup miss, never a reason to mint a visible about:blank Chrome tab.
  app.get("/pages/:name", async (c) => {
    const name = c.req.param("name");
    let existing = resolveNamedPage(name);
    if (!existing) {
      // Target.detachedFromTarget can empty connectedTargets briefly while the
      // replacement attach is in flight. POST /pages already waits 250ms for
      // that window; attach-only lookup needs the same beat so snapshot/click
      // during soft-detach recovery does not 404 a still-open named tab.
      await new Promise((resolve) => setTimeout(resolve, 250));
      existing = resolveNamedPage(name);
    }
    if (!existing) {
      return c.json({ error: `No named page \"${name}\" is open` }, 404);
    }
    return c.json({
      wsEndpoint: `ws://${host}:${port}/cdp`,
      name,
      targetId: existing.targetId,
      url: existing.targetInfo.url,
      title: existing.targetInfo.title,
      created: false,
    });
  });

  app.post("/pages", async (c) => {
    const body = await c.req.json();
    const name = body.name as string;

    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }

    // Reuse existing named tab. Important: do NOT mint a new about:blank when
    // sessionId churns (common after debugger attach / password-manager
    // activity on username fields) but the tab targetId is still connected.
    let existing = resolveNamedPage(name);
    if (!existing) {
      // Extension reconnect re-registers tabs asynchronously. Give targetId
      // rebind a beat before minting a blank tab under the same name.
      await new Promise((resolve) => setTimeout(resolve, 250));
      existing = resolveNamedPage(name);
    }
    const existingUrl = existing?.targetInfo?.url || "";
    const existingIsBlank =
      !existingUrl || existingUrl === "about:blank" || existingUrl === "about:newtab";

    const adoptTargetId = typeof body.targetId === "string" ? body.targetId : "";
    const requestedUrl = typeof body.url === "string" ? body.url : "";
    if (adoptTargetId && (!existing || existingIsBlank)) {
      const adopt = findTargetById(adoptTargetId);
      if (adopt) {
        namedPages.set(name, {
          sessionId: adopt.sessionId,
          targetId: adopt.targetId,
        });
        protectedTargetIds.add(adopt.targetId);
        return c.json({
          wsEndpoint: `ws://${host}:${port}/cdp`,
          name,
          targetId: adopt.targetId,
          url: adopt.targetInfo.url,
          title: adopt.targetInfo.title,
          created: false,
          adopted: true,
        });
      }
    }

    if ((!existing || existingIsBlank) && requestedUrl && !isBlankPageUrl(requestedUrl)) {
      const adopt = pickExistingPageTarget(listedTargets(), requestedUrl, {
        excludeTargetId: existing?.targetId,
      });
      if (adopt?.sessionId) {
        const live = findTargetById(adopt.targetId);
        if (live) {
          namedPages.set(name, { sessionId: live.sessionId, targetId: live.targetId });
          protectedTargetIds.add(live.targetId);
          if (existing && existingIsBlank && relayCreatedTargetIds.has(existing.targetId)) {
            quietDetach.add(existing.sessionId);
            await sendToExtension({
              method: "forwardCDPCommand",
              params: {
                method: "Target.closeTarget",
                params: { targetId: existing.targetId },
              },
            }).catch((err) => log("failed to close leftover blank named tab", err));
          }
          return c.json({
            wsEndpoint: `ws://${host}:${port}/cdp`,
            name,
            targetId: live.targetId,
            url: live.targetInfo.url,
            title: live.targetInfo.title,
            created: false,
            adopted: true,
          });
        }
      }
    }

    if (existing && !existingIsBlank) {
      // activateTarget is a no-op under extension focusPolicy=background
      await sendToExtension({
        method: "forwardCDPCommand",
        params: {
          method: "Target.activateTarget",
          params: { targetId: existing.targetId },
        },
      });
      return c.json({
        wsEndpoint: `ws://${host}:${port}/cdp`,
        name,
        targetId: existing.targetId,
        url: existing.targetInfo.url,
        title: existing.targetInfo.title,
        // Lets attach-only callers (click/type/fill) tell "attached to the tab
        // you meant" from "minted a blank one", without a racy pre-check.
        created: false,
      });
    }
    if (existing && existingIsBlank) {
      return c.json({
        wsEndpoint: `ws://${host}:${port}/cdp`,
        name,
        targetId: existing.targetId,
        url: existing.targetInfo.url,
        title: existing.targetInfo.title,
        created: false,
      });
    }
    namedPages.delete(name);

    if (!extensionWs) {
      return c.json({ error: "Extension not connected" }, 503);
    }

    try {
      const groupTitle = typeof body.groupTitle === "string" ? body.groupTitle.trim() : "";
      const result = (await sendToExtension({
        method: "forwardCDPCommand",
        params: {
          method: "Target.createTarget",
          params: {
            url: !isBlankPageUrl(requestedUrl) ? requestedUrl : "about:blank",
            ...(groupTitle ? { groupTitle } : {}),
          },
        },
      })) as { targetId: string };
      if (result?.targetId) relayCreatedTargetIds.add(result.targetId);

      if (c.req.raw.signal.aborted) {
        await sendToExtension({
          method: "forwardCDPCommand",
          params: {
            method: "Target.closeTarget",
            params: { targetId: result.targetId },
          },
        }).catch(() => null);
        return c.json({ error: "client disconnected before the new tab was ready" }, 408);
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      for (const [, target] of connectedTargets) {
        if (target.targetId === result.targetId) {
          namedPages.set(name, {
            sessionId: target.sessionId,
            targetId: target.targetId,
          });
          await sendToExtension({
            method: "forwardCDPCommand",
            params: {
              method: "Target.activateTarget",
              params: { targetId: target.targetId },
            },
          });
          return c.json({
            wsEndpoint: `ws://${host}:${port}/cdp`,
            name,
            targetId: target.targetId,
            url: target.targetInfo.url,
            title: target.targetInfo.title,
            created: true,
          });
        }
      }

      throw new Error("Target created but not found in registry");
    } catch (err) {
      log("Error creating tab:", err);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.delete("/pages/:name", (c) => {
    const name = c.req.param("name");
    const deleted = namedPages.delete(name);
    return c.json({ success: deleted });
  });

  app.get(
    "/cdp/:clientId?",
    upgradeWebSocket((c) => {
      const clientId =
        c.req.param("clientId") || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      return {
        onOpen(_event, ws) {
          if (playwrightClients.has(clientId)) {
            log(`Rejecting duplicate client ID: ${clientId}`);
            ws.close(1000, "Client ID already connected");
            return;
          }

          playwrightClients.set(clientId, {
            id: clientId,
            ws,
            knownTargets: new Set(),
          });
          log(`Playwright client connected: ${clientId}`);
        },

        async onMessage(event, _ws) {
          let message: CDPCommand;

          try {
            message = JSON.parse(event.data.toString());
          } catch {
            return;
          }

          const { id, sessionId, method, params } = message;

          if (!extensionWs) {
            sendToPlaywright(
              {
                id,
                sessionId,
                error: { message: "Extension not connected" },
              },
              clientId
            );
            return;
          }

          try {
            const result = await routeCdpCommand({ method, params, sessionId, clientId });

            if (method === "Target.setAutoAttach" && !sessionId) {
              for (const target of connectedTargets.values()) {
                sendAttachedToTarget(target, clientId);
              }
            }

            if (
              method === "Target.setDiscoverTargets" &&
              (params as { discover?: boolean })?.discover
            ) {
              for (const target of connectedTargets.values()) {
                sendToPlaywright(
                  {
                    method: "Target.targetCreated",
                    params: {
                      targetInfo: { ...target.targetInfo, attached: true },
                    },
                  },
                  clientId
                );
              }
            }

            if (
              method === "Target.attachToTarget" &&
              (result as { sessionId?: string })?.sessionId
            ) {
              const targetId = params?.targetId as string;
              const target = Array.from(connectedTargets.values()).find(
                (t) => t.targetId === targetId
              );
              if (target) {
                sendAttachedToTarget(target, clientId);
              }
            }

            sendToPlaywright({ id, sessionId, result }, clientId);
            while (deferredCdpEvents.length) {
              const event = deferredCdpEvents.shift();
              if (event) sendToPlaywright(event, clientId);
            }
          } catch (e) {
            log("Error handling CDP command:", method, e);
            sendToPlaywright(
              {
                id,
                sessionId,
                error: { message: (e as Error).message },
              },
              clientId
            );
          }
        },

        onClose() {
          playwrightClients.delete(clientId);
          log(`Playwright client disconnected: ${clientId}`);
        },

        onError(event) {
          log(`Playwright WebSocket error [${clientId}]:`, event);
        },
      };
    })
  );

  app.get(
    "/extension",
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          if (extensionWs) {
            log("Closing existing extension connection");
            extensionWs.close(4001, "Extension Replaced");

            extensionBrowser = null;
            extensionDebugger = null;
            connectedTargets.clear();
            namedPages.clear();
            clearAdoptionState();
            for (const pending of extensionPendingRequests.values()) {
              pending.reject(new Error("Extension connection replaced"));
            }
            extensionPendingRequests.clear();
          }

          extensionWs = ws;
          log("Extension connected");
        },

        async onMessage(event, ws) {
          let message: ExtensionMessage;

          try {
            message = JSON.parse(event.data.toString());
          } catch {
            ws.close(1000, "Invalid JSON");
            return;
          }

          if ("id" in message && typeof message.id === "number") {
            const pending = extensionPendingRequests.get(message.id);
            if (!pending) {
              log("Unexpected response with id:", message.id);
              return;
            }

            extensionPendingRequests.delete(message.id);

            if ((message as ExtensionResponseMessage).error) {
              pending.reject(new Error((message as ExtensionResponseMessage).error));
            } else {
              pending.resolve((message as ExtensionResponseMessage).result);
            }
            return;
          }

          if ("method" in message && message.method === "log") {
            const { level, args } = message.params;
            console.error(`[extension:${level}]`, ...args);
            return;
          }

          if ("method" in message && message.method === "register") {
            const browser = message.params?.browser;
            if (browser && typeof browser === "object") {
              extensionBrowser = {
                name: String(browser.name || "Unknown").slice(0, 100),
                version: String(browser.version || "").slice(0, 60),
              };
              log(`Extension host browser: ${extensionBrowser.name} ${extensionBrowser.version}`);
            }
            const capability = message.params?.debugger;
            if (capability && typeof capability === "object" && capability.available === false) {
              extensionDebugger = {
                available: false,
                reason: String(capability.reason || "chrome.debugger unavailable").slice(0, 200),
              };
              log(`Extension reports chrome.debugger unavailable: ${extensionDebugger.reason}`);
            }
            return;
          }

          if ("method" in message && message.method === "forwardCDPEvent") {
            const eventMsg = message as ExtensionEventMessage;
            const { method, params, sessionId } = eventMsg.params;

            if (method === "Page.frameNavigated" && sessionId) {
              const frame = (params as { frame?: { id?: string } } | undefined)?.frame;
              if (frame?.id) lastFrameId.set(sessionId, frame.id);
            }

            const relayExtensionEvent = (event: CDPEvent) => {
              sendToPlaywright(event);
              if (!event.sessionId) return;
              for (const adopted of adoptedBlanks.values()) {
                if (adopted.liveSessionId === event.sessionId) {
                  sendToPlaywright({ ...event, sessionId: adopted.clientSessionId });
                }
              }
            };

            if (method === "Target.attachedToTarget") {
              const targetParams = params as {
                sessionId: string;
                targetInfo: TargetInfo;
              };

              const target: ConnectedTarget = {
                sessionId: targetParams.sessionId,
                targetId: targetParams.targetInfo.targetId,
                targetInfo: targetParams.targetInfo,
              };
              connectedTargets.set(targetParams.sessionId, target);

              // Rebind any named pages that only retained targetId after churn
              for (const [name, entry] of namedPages) {
                if (entry.targetId === target.targetId && entry.sessionId !== target.sessionId) {
                  namedPages.set(name, {
                    sessionId: target.sessionId,
                    targetId: target.targetId,
                  });
                  log(`Named page "${name}" rebound on attach → ${target.sessionId}`);
                }
              }

              log(`Target attached: ${targetParams.targetInfo.url} (${targetParams.sessionId})`);

              sendAttachedToTarget(target);
            } else if (method === "Target.detachedFromTarget") {
              const detachParams = params as { sessionId: string };
              if (quietDetach.has(detachParams.sessionId)) {
                const owner = adoptedBlanks.get(detachParams.sessionId)?.ownerClientId;
                quietDetach.delete(detachParams.sessionId);
                connectedTargets.delete(detachParams.sessionId);
                for (const client of playwrightClients.values()) {
                  if (owner && client.id === owner) continue;
                  sendToPlaywright(
                    {
                      method: "Target.detachedFromTarget",
                      params: detachParams,
                    },
                    client.id
                  );
                }
                log(`Suppressed detach for adopted blank session ${detachParams.sessionId}`);
                return;
              }
              const detached = connectedTargets.get(detachParams.sessionId);
              connectedTargets.delete(detachParams.sessionId);

              // Session churn is common (debugger re-attach, autofill UI).
              // Keep the named mapping if the same targetId reappears under a
              // new session; only drop the name when the target is truly gone.
              for (const [name, entry] of namedPages) {
                if (entry.sessionId !== detachParams.sessionId) continue;
                const rebound =
                  (detached && findTargetById(detached.targetId)) || findTargetById(entry.targetId);
                if (rebound) {
                  namedPages.set(name, {
                    sessionId: rebound.sessionId,
                    targetId: rebound.targetId,
                  });
                  log(`Named page "${name}" rebound after session detach → ${rebound.sessionId}`);
                } else {
                  // Keep targetId so a late re-attach can still resolve via
                  // resolveNamedPage before we mint a new blank tab.
                  namedPages.set(name, {
                    sessionId: "",
                    targetId: entry.targetId,
                  });
                  log(
                    `Named page "${name}" session detached; retaining targetId ${entry.targetId}`
                  );
                }
              }

              log(`Target detached: ${detachParams.sessionId}`);

              for (const adopted of [...adoptedBlanks.values()]) {
                if (
                  adopted.liveSessionId !== detachParams.sessionId &&
                  adopted.clientSessionId !== detachParams.sessionId
                ) {
                  continue;
                }
                const rebound = findTargetById(adopted.liveTargetId);
                if (rebound && rebound.sessionId !== adopted.liveSessionId) {
                  adopted.liveSessionId = rebound.sessionId;
                  log(`Adopted session ${adopted.clientSessionId} rebound → ${rebound.sessionId}`);
                  continue;
                }
                if (rebound && adopted.clientSessionId !== detachParams.sessionId) {
                  continue;
                }
                adoptedBlanks.delete(adopted.clientSessionId);
                adoptedByTarget.delete(adopted.clientTargetId);
                lastFrameId.delete(adopted.clientSessionId);
                if (adopted.clientSessionId !== detachParams.sessionId) {
                  sendToPlaywright({
                    method: "Target.detachedFromTarget",
                    params: { sessionId: adopted.clientSessionId },
                  });
                }
                log(`Dropped adopted session ${adopted.clientSessionId}`);
              }

              sendToPlaywright({
                method: "Target.detachedFromTarget",
                params: detachParams,
              });
            } else if (method === "Target.targetInfoChanged") {
              const infoParams = params as { targetInfo: TargetInfo };
              for (const target of connectedTargets.values()) {
                if (target.targetId === infoParams.targetInfo.targetId) {
                  target.targetInfo = infoParams.targetInfo;
                  break;
                }
              }

              relayExtensionEvent({
                method: "Target.targetInfoChanged",
                params: infoParams,
              });
            } else {
              relayExtensionEvent({
                sessionId,
                method,
                params,
              });
            }
          }
        },

        onClose(_event, ws) {
          if (extensionWs && extensionWs !== ws) {
            log("Old extension connection closed");
            return;
          }

          log("Extension disconnected");

          for (const pending of extensionPendingRequests.values()) {
            pending.reject(new Error("Extension connection closed"));
          }
          extensionPendingRequests.clear();

          extensionWs = null;
          extensionBrowser = null;
          extensionDebugger = null;
          connectedTargets.clear();
          namedPages.clear();
          clearAdoptionState();

          for (const client of playwrightClients.values()) {
            client.ws.close(1000, "Extension disconnected");
          }
          playwrightClients.clear();
        },

        onError(event) {
          log("Extension WebSocket error:", event);
        },
      };
    })
  );

  const server = serve({ fetch: app.fetch, port, hostname: host });
  injectWebSocket(server);

  const wsEndpoint = `ws://${host}:${port}/cdp`;

  log("CDP relay server started");
  log(`  HTTP: http://${host}:${port}`);
  log(`  CDP endpoint: ${wsEndpoint}`);
  log(`  Extension endpoint: ws://${host}:${port}/extension`);
  log(`  Local documents: ${localDocOrigin} (capability URLs only)`);
  log("Waiting for extension to connect...");

  return {
    wsEndpoint,
    port,
    localDocOrigin,
    async stop() {
      for (const client of playwrightClients.values()) {
        client.ws.close(1000, "Server stopped");
      }
      playwrightClients.clear();
      extensionWs?.close(1000, "Server stopped");
      // Capabilities die with the relay.
      localDocs.clear();
      server.close();
      docServer.close();
    },
  };
}
