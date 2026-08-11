/**
 * CDPRouter - Routes CDP commands to the correct tab.
 */

import type { Logger } from "../utils/logger";
import type { TabManager } from "./TabManager";
import type {
  ExtensionCommandMessage,
  FocusPolicy,
  TabInfo,
} from "../utils/types";

export interface CDPRouterDeps {
  logger: Logger;
  tabManager: TabManager;
  /** Defaults to background (never steal OS focus). Prefer effective policy (override → default). */
  getFocusPolicy?: () => Promise<FocusPolicy> | FocusPolicy;
  /** Clear one-shot override after a successful focus apply. */
  consumeFocusOverride?: () => Promise<void> | void;
  /** Set a temporary agent focus override (does not change popup default). */
  setFocusOverride?: (opts: {
    policy: FocusPolicy | string;
    reason?: string;
    ttlMs?: number;
    consumeOnUse?: boolean;
  }) => Promise<unknown> | unknown;
  clearFocusOverride?: () => Promise<void> | void;
}

export class CDPRouter {
  private logger: Logger;
  private tabManager: TabManager;
  private getFocusPolicy: () => Promise<FocusPolicy> | FocusPolicy;
  private consumeFocusOverride?: () => Promise<void> | void;
  private setFocusOverride?: CDPRouterDeps["setFocusOverride"];
  private clearFocusOverride?: () => Promise<void> | void;
  private browserHandGroupId: number | null = null;

  constructor(deps: CDPRouterDeps) {
    this.logger = deps.logger;
    this.tabManager = deps.tabManager;
    this.getFocusPolicy = deps.getFocusPolicy ?? (() => "background");
    this.consumeFocusOverride = deps.consumeFocusOverride;
    this.setFocusOverride = deps.setFocusOverride;
    this.clearFocusOverride = deps.clearFocusOverride;
  }

  private async resolveFocusPolicy(): Promise<FocusPolicy> {
    try {
      return await this.getFocusPolicy();
    } catch {
      return "background";
    }
  }

  /**
   * Apply focus policy for activateTarget / bringToFront.
   * background: no-op (default — agents must not steal the user's focus)
   * tab: activate tab in its window only
   * window: activate tab and focus the Chrome window (legacy / human-in-the-loop)
   */
  private async applyFocusPolicy(targetTabId: number): Promise<void> {
    const policy = await this.resolveFocusPolicy();
    if (policy === "background") {
      this.logger.debug(
        "Skipping tab/window focus (focusPolicy=background) for tab:",
        targetTabId
      );
      return;
    }

    this.logger.log(
      `Applying focusPolicy=${policy} for tab:`,
      targetTabId
    );
    const tab = await chrome.tabs.get(targetTabId);
    await chrome.tabs.update(targetTabId, { active: true });
    if (policy === "window" && tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    try {
      await this.consumeFocusOverride?.();
    } catch (err) {
      this.logger.debug("consumeFocusOverride failed:", err);
    }
  }

  /**
   * Gets or creates the "Browser Hand" tab group, returning its ID.
   */
  private async getOrCreateBrowserHandGroup(tabId: number): Promise<number> {
    // If we have a cached group ID, verify it still exists
    if (this.browserHandGroupId !== null) {
      try {
        await chrome.tabGroups.get(this.browserHandGroupId);
        // Group exists, add tab to it
        await chrome.tabs.group({ tabIds: [tabId], groupId: this.browserHandGroupId });
        return this.browserHandGroupId;
      } catch {
        // Group no longer exists, reset cache
        this.browserHandGroupId = null;
      }
    }

    // Create a new group with this tab
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: "Browser Hand",
      color: "blue",
    });
    this.browserHandGroupId = groupId;
    return groupId;
  }

  /**
   * Handle an incoming CDP command from the relay.
   */
  async handleCommand(msg: ExtensionCommandMessage): Promise<unknown> {
    if (msg.method !== "forwardCDPCommand") return;

    let targetTabId: number | undefined;
    let targetTab: TabInfo | undefined;

    // Find target tab by sessionId
    if (msg.params.sessionId) {
      const found = this.tabManager.getBySessionId(msg.params.sessionId);
      if (found) {
        targetTabId = found.tabId;
        targetTab = found.tab;
      }
    }

    // Check child sessions (iframes, workers)
    if (!targetTab && msg.params.sessionId) {
      const parentTabId = this.tabManager.getParentTabId(msg.params.sessionId);
      if (parentTabId) {
        targetTabId = parentTabId;
        targetTab = this.tabManager.get(parentTabId);
        this.logger.debug(
          "Found parent tab for child session:",
          msg.params.sessionId,
          "tabId:",
          parentTabId
        );
      }
    }

    // Find by targetId in params
    if (
      !targetTab &&
      msg.params.params &&
      typeof msg.params.params === "object" &&
      "targetId" in msg.params.params
    ) {
      const found = this.tabManager.getByTargetId(msg.params.params.targetId as string);
      if (found) {
        targetTabId = found.tabId;
        targetTab = found.tab;
      }
    }

    const debuggee = targetTabId ? { tabId: targetTabId } : undefined;

    // Handle special commands
    switch (msg.params.method) {
      case "DevBrowser.setFocusOverride": {
        if (!this.setFocusOverride) {
          throw new Error("Focus override is not available");
        }
        const params = (msg.params.params || {}) as {
          policy?: string;
          reason?: string;
          ttlMs?: number;
          consumeOnUse?: boolean;
        };
        if (!params.policy) {
          throw new Error("policy is required (background|tab|window)");
        }
        const result = await this.setFocusOverride({
          policy: params.policy,
          reason: params.reason,
          ttlMs: params.ttlMs,
          consumeOnUse: params.consumeOnUse,
        });
        this.logger.log(
          "Focus override set:",
          params.policy,
          params.reason || ""
        );
        return result ?? { ok: true, policy: params.policy };
      }

      case "DevBrowser.clearFocusOverride": {
        await this.clearFocusOverride?.();
        return { ok: true };
      }

      case "Runtime.enable":
      case "Page.enable":
      case "DOM.enable": {
        if (!debuggee || !targetTabId) {
          throw new Error(
            `No debuggee found for ${msg.params.method} (sessionId: ${msg.params.sessionId})`
          );
        }
        await this.tabManager.ensureDebuggerAttached(targetTabId);
        // Scripting fallback: domains are no-ops (evaluate goes through scripting).
        if (this.tabManager.usesScriptingFallback(targetTabId)) {
          return {};
        }
        if (msg.params.method === "Runtime.enable") {
          try {
            await chrome.debugger.sendCommand(debuggee, "Runtime.disable");
            await new Promise((resolve) => setTimeout(resolve, 200));
          } catch {
            // Ignore
          }
        }
        try {
          return await chrome.debugger.sendCommand(
            debuggee,
            msg.params.method,
            msg.params.params
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/chrome-extension:\/\//i.test(message) || /Cannot access/i.test(message)) {
            this.logger.debug(
              `${msg.params.method} wedged; forceReattach then scripting fallback`,
              targetTabId
            );
            try {
              await this.tabManager.forceReattach(targetTabId);
              if (!this.tabManager.usesScriptingFallback(targetTabId)) {
                return await chrome.debugger.sendCommand(
                  debuggee,
                  msg.params.method,
                  msg.params.params
                );
              }
            } catch {
              // fall through to scripting mode
            }
            this.tabManager.markScriptingFallback(targetTabId, message);
            return {};
          }
          throw err;
        }
      }

      case "Runtime.evaluate": {
        if (!debuggee || !targetTab || !targetTabId) {
          throw new Error(
            `No debuggee found for Runtime.evaluate (sessionId: ${msg.params.sessionId})`
          );
        }
        await this.tabManager.ensureDebuggerAttached(targetTabId);
        const expression =
          typeof msg.params.params?.expression === "string"
            ? msg.params.params.expression
            : "";
        if (this.tabManager.usesScriptingFallback(targetTabId)) {
          this.logger.debug("Runtime.evaluate via scripting fallback", targetTabId);
          return await this.tabManager.evaluateViaScripting(targetTabId, expression);
        }
        const evalSession: chrome.debugger.DebuggerSession = {
          ...debuggee,
          sessionId:
            msg.params.sessionId !== targetTab.sessionId
              ? msg.params.sessionId
              : undefined,
        };
        try {
          return await chrome.debugger.sendCommand(
            evalSession,
            "Runtime.evaluate",
            msg.params.params
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/chrome-extension:\/\//i.test(message) || /Cannot access/i.test(message)) {
            this.logger.debug(
              "Runtime.evaluate wedged; scripting fallback",
              targetTabId
            );
            this.tabManager.markScriptingFallback(targetTabId, message);
            return await this.tabManager.evaluateViaScripting(
              targetTabId,
              expression
            );
          }
          throw err;
        }
      }

      case "Target.createTarget": {
        const url = (msg.params.params?.url as string) || "about:blank";
        this.logger.debug("Creating new tab with URL:", url);
        const tab = await chrome.tabs.create({ url, active: false });
        if (!tab.id) throw new Error("Failed to create tab");

        // Add tab to "Browser Hand" group
        await this.getOrCreateBrowserHandGroup(tab.id);

        await new Promise((resolve) => setTimeout(resolve, 100));
        await this.tabManager.register(tab);
        const targetInfo = await this.tabManager.attach(tab.id);
        return { targetId: targetInfo.targetId };
      }

      case "Target.closeTarget": {
        if (!targetTabId) {
          this.logger.log(`Target not found: ${msg.params.params?.targetId}`);
          return { success: false };
        }
        await chrome.tabs.remove(targetTabId);
        return { success: true };
      }

      case "Target.activateTarget": {
        if (!targetTabId) {
          this.logger.log(`Target not found for activation: ${msg.params.params?.targetId}`);
          return {};
        }
        await this.applyFocusPolicy(targetTabId);
        return {};
      }

      case "Page.bringToFront": {
        // Playwright/CDP often calls this before interaction; do not let it
        // steal OS focus when policy is background.
        if (targetTabId) {
          await this.applyFocusPolicy(targetTabId);
        }
        return {};
      }

      case "Page.captureScreenshot": {
        if (!debuggee || !targetTabId) {
          throw new Error(
            `No debuggee found for Page.captureScreenshot (sessionId: ${msg.params.sessionId})`
          );
        }
        return await this.captureScreenshot(
          targetTabId,
          debuggee,
          (msg.params.params || {}) as Record<string, unknown>
        );
      }
    }

    if (!debuggee || !targetTab || !targetTabId) {
      throw new Error(
        `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId}`
      );
    }

    this.logger.debug("CDP command:", msg.params.method, "for tab:", targetTabId);
    await this.tabManager.ensureDebuggerAttached(targetTabId);

    if (this.tabManager.usesScriptingFallback(targetTabId)) {
      // Only evaluate is supported without the debugger; surface a clear error
      // for other CDP methods so agents can re-open / re-navigate.
      if (msg.params.method === "Runtime.evaluate") {
        const expression =
          typeof msg.params.params?.expression === "string"
            ? msg.params.params.expression
            : "";
        return await this.tabManager.evaluateViaScripting(targetTabId, expression);
      }
      throw new Error(
        `Tab is on scripting fallback after password-manager wedge; ${msg.params.method} requires debugger. Re-open the page or use evaluate/fill/type/click.`
      );
    }

    const debuggerSession: chrome.debugger.DebuggerSession = {
      ...debuggee,
      sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : undefined,
    };

    try {
      return await chrome.debugger.sendCommand(
        debuggerSession,
        msg.params.method,
        msg.params.params
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        msg.params.method === "Runtime.evaluate" &&
        (/chrome-extension:\/\//i.test(message) || /Cannot access/i.test(message))
      ) {
        this.tabManager.markScriptingFallback(targetTabId, message);
        const expression =
          typeof msg.params.params?.expression === "string"
            ? msg.params.params.expression
            : "";
        return await this.tabManager.evaluateViaScripting(targetTabId, expression);
      }
      throw err;
    }
  }

  /**
   * Screenshot without hanging the relay. chrome.debugger Page.captureScreenshot
   * can stall indefinitely on some background tabs; race a short CDP attempt,
   * then fall back to tabs.captureVisibleTab after activating the tab in its
   * window (does not force OS focus — chrome.windows.update is not called).
   */
  private async captureScreenshot(
    tabId: number,
    debuggee: chrome.debugger.Debuggee,
    params: Record<string, unknown>
  ): Promise<{ data: string }> {
    await this.tabManager.ensureDebuggerAttached(tabId);

    const format =
      params.format === "jpeg" || params.format === "png"
        ? params.format
        : "png";

    if (!this.tabManager.usesScriptingFallback(tabId)) {
      try {
        // Chrome 120+ requires fromSurface:true ("Only screenshots from surface
        // are allowed"). That call can still hang on some background tabs, so
        // race a short timeout then fall back to captureVisibleTab.
        const cdpParams: Record<string, unknown> = {
          ...params,
          format,
          fromSurface: true,
        };
        if (params.captureBeyondViewport === true) {
          cdpParams.captureBeyondViewport = true;
        }
        const result = (await Promise.race([
          chrome.debugger.sendCommand(
            debuggee,
            "Page.captureScreenshot",
            cdpParams
          ),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Page.captureScreenshot timed out")),
              8000
            )
          ),
        ])) as { data?: string } | undefined;
        if (result?.data) {
          return { data: result.data };
        }
      } catch (err) {
        this.logger.debug(
          "CDP screenshot failed, falling back to captureVisibleTab:",
          err instanceof Error ? err.message : err
        );
      }
    }

    // Activate tab inside its window so captureVisibleTab sees it. Do not call
    // chrome.windows.update(..., { focused: true }) — that steals OS focus.
    const previous = await chrome.tabs.query({
      active: true,
      currentWindow: false,
    });
    let previousActiveId: number | undefined;
    try {
      const target = await chrome.tabs.get(tabId);
      const inWindow = await chrome.tabs.query({
        active: true,
        windowId: target.windowId,
      });
      previousActiveId = inWindow[0]?.id;
      if (previousActiveId !== tabId) {
        await chrome.tabs.update(tabId, { active: true });
        // brief settle for compositor
        await new Promise((r) => setTimeout(r, 120));
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
        format: format === "jpeg" ? "jpeg" : "png",
      });
      const data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      if (!data) {
        throw new Error("captureVisibleTab returned empty image");
      }
      return { data };
    } finally {
      if (
        previousActiveId &&
        previousActiveId !== tabId &&
        typeof previousActiveId === "number"
      ) {
        try {
          await chrome.tabs.update(previousActiveId, { active: true });
        } catch {
          // ignore restore failures
        }
      }
      void previous;
    }
  }

  /**
   * Handle debugger events from Chrome.
   */
  handleDebuggerEvent(
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown,
    sendMessage: (msg: unknown) => void
  ): void {
    const tab = source.tabId ? this.tabManager.get(source.tabId) : undefined;
    if (!tab) return;

    this.logger.debug("Forwarding CDP event:", method, "from tab:", source.tabId);

    // Track child sessions
    if (
      method === "Target.attachedToTarget" &&
      params &&
      typeof params === "object" &&
      "sessionId" in params
    ) {
      const sessionId = (params as { sessionId: string }).sessionId;
      this.tabManager.trackChildSession(sessionId, source.tabId!);
    }

    if (
      method === "Target.detachedFromTarget" &&
      params &&
      typeof params === "object" &&
      "sessionId" in params
    ) {
      const sessionId = (params as { sessionId: string }).sessionId;
      this.tabManager.untrackChildSession(sessionId);
    }

    sendMessage({
      method: "forwardCDPEvent",
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    });
  }
}
