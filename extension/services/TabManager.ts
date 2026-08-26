/**
 * TabManager - Manages tab state and debugger attachment.
 */

import type { Logger } from "../utils/logger";
import type { TabInfo, TargetInfo } from "../utils/types";

export type SendMessageFn = (message: unknown) => void;

export interface TabManagerDeps {
  logger: Logger;
  sendMessage: SendMessageFn;
}

export class TabManager {
  private tabs = new Map<number, TabInfo>();
  private childSessions = new Map<string, number>(); // sessionId -> parentTabId
  private nextSessionId = 1;
  private lastFocusedTabId: number | null = null;
  private logger: Logger;
  private sendMessage: SendMessageFn;

  constructor(deps: TabManagerDeps) {
    this.logger = deps.logger;
    this.sendMessage = deps.sendMessage;
  }

  /**
   * Get tab info by session ID.
   */
  getBySessionId(sessionId: string): { tabId: number; tab: TabInfo } | undefined {
    for (const [tabId, tab] of this.tabs) {
      if (tab.sessionId === sessionId) {
        return { tabId, tab };
      }
    }
    return undefined;
  }

  /**
   * Get tab info by target ID.
   */
  getByTargetId(targetId: string): { tabId: number; tab: TabInfo } | undefined {
    for (const [tabId, tab] of this.tabs) {
      if (tab.targetId === targetId) {
        return { tabId, tab };
      }
    }
    return undefined;
  }

  /**
   * Get parent tab ID for a child session (iframe, worker).
   */
  getParentTabId(sessionId: string): number | undefined {
    return this.childSessions.get(sessionId);
  }

  /**
   * Get tab info by tab ID.
   */
  get(tabId: number): TabInfo | undefined {
    return this.tabs.get(tabId);
  }

  /**
   * Check if a tab is tracked.
   */
  has(tabId: number): boolean {
    return this.tabs.has(tabId);
  }

  /**
   * Set tab info (used for tests and intermediate states).
   */
  set(tabId: number, info: TabInfo): void {
    this.tabs.set(tabId, info);
  }

  /**
   * Track a child session (iframe, worker).
   */
  trackChildSession(sessionId: string, parentTabId: number): void {
    this.logger.debug("Child target attached:", sessionId, "for tab:", parentTabId);
    this.childSessions.set(sessionId, parentTabId);
  }

  /**
   * Untrack a child session.
   */
  untrackChildSession(sessionId: string): void {
    this.logger.debug("Child target detached:", sessionId);
    this.childSessions.delete(sessionId);
  }

  /**
   * Tabs we can safely list / attach to. chrome:// and chrome-extension://
   * pages throw "Cannot access a chrome-extension:// URL of different
   * extension" (and similar) and spam chrome://extensions errors.
   */
  isControllableUrl(url: string | undefined): boolean {
    if (!url) return false;
    if (url === "about:blank" || url.startsWith("about:blank?")) return true;
    if (/^https?:\/\//i.test(url)) return true;
    if (url.startsWith("file://")) return true;
    return false;
  }

  /**
   * Register a Chrome tab with the relay without attaching debugger yet.
   * The debugger is attached lazily on the first CDP command for the tab.
   */
  async register(tab: chrome.tabs.Tab): Promise<TargetInfo | null> {
    if (!tab.id) return null;

    const url = tab.url || tab.pendingUrl || "";
    // Drop tracking if the tab left a controllable URL (e.g. chrome://extensions).
    if (url && !this.isControllableUrl(url)) {
      if (this.tabs.has(tab.id)) {
        this.logger.debug("Ignoring non-controllable tab:", tab.id, url);
        this.detach(tab.id, true);
      }
      return null;
    }

    const existing = this.tabs.get(tab.id);
    const sessionId = existing?.sessionId ?? `pw-tab-${this.nextSessionId++}`;
    const targetId = existing?.targetId ?? `tab-${tab.id}`;
    const targetInfo = this.targetInfoFromTab(tab, targetId);

    this.tabs.set(tab.id, {
      ...existing,
      sessionId,
      targetId,
      targetInfo,
      state: "connected",
      debuggerAttached: existing?.debuggerAttached ?? false,
      debugTransport: existing?.debugTransport,
    });

    this.sendAttached(sessionId, targetInfo);
    return targetInfo;
  }

  /**
   * Mark Chrome's last-focused window's active tab so clients can identify
   * "this tab" without attaching and probing document.hasFocus().
   */
  async markActiveTab(tabId: number): Promise<void> {
    const activeTab = await chrome.tabs.get(tabId);
    if (!activeTab.id) return;
    this.lastFocusedTabId = activeTab.id;
    await this.emitTargetInfoForTabs(await chrome.tabs.query({}));
  }

  /**
   * Refresh last-focused + active flags from live Chrome state.
   */
  async refreshFocusFlags(): Promise<void> {
    try {
      const [focused] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (focused?.id) {
        this.lastFocusedTabId = focused.id;
      }
    } catch {
      // No focused window (all minimized) — keep the last known tab.
    }
  }

  /**
   * Live inventory for Target.getTargets / `browser-hand tabs`.
   * Re-reads chrome.tabs so active/focused are current without debugger attach.
   */
  async listTargets(): Promise<TargetInfo[]> {
    await this.refreshFocusFlags();
    const tabs = await chrome.tabs.query({});
    const infos: TargetInfo[] = [];
    for (const tab of tabs) {
      const targetInfo = await this.register(tab);
      if (targetInfo) infos.push(targetInfo);
    }
    return infos;
  }

  /**
   * Register all current browser tabs so the relay can list/target them.
   */
  async syncExistingTabs(): Promise<void> {
    const infos = await this.listTargets();
    this.logger.log(`Registered ${infos.length} browser tabs`);
  }

  private async emitTargetInfoForTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
    await Promise.all(
      tabs.map(async (tab) => {
        const targetInfo = await this.register(tab);
        if (targetInfo) {
          this.sendMessage({
            method: "forwardCDPEvent",
            params: {
              method: "Target.targetInfoChanged",
              params: { targetInfo },
            },
          });
        }
      })
    );
  }

  /**
   * Attach debugger to a tab if needed and return its target info.
   */
  async attach(tabId: number): Promise<TargetInfo> {
    if (!this.tabs.has(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      await this.register(tab);
    }

    await this.ensureDebuggerAttached(tabId);

    const tab = this.tabs.get(tabId);
    if (!tab?.targetInfo) {
      throw new Error(`No target info for tab ${tabId}`);
    }

    return tab.targetInfo;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait until the tab is load-complete on an http(s) URL (password-manager
   * navigations after username often fire target_closed mid-load).
   */
  async waitForTabReady(
    tabId: number,
    timeoutMs = 5000
  ): Promise<chrome.tabs.Tab | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const live = await chrome.tabs.get(tabId);
        const url = live.url || live.pendingUrl || "";
        if (
          live.status === "complete" &&
          /^https?:\/\//i.test(url) &&
          !url.startsWith("chrome://") &&
          !url.startsWith("chrome-extension://")
        ) {
          return live;
        }
      } catch {
        return null;
      }
      await this.sleep(100);
    }
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  usesScriptingFallback(tabId: number): boolean {
    return this.tabs.get(tabId)?.debugTransport === "scripting";
  }

  markScriptingFallback(tabId: number, reason: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.logger.log(
      `Tab ${tabId} switching to scripting fallback:`,
      reason
    );
    this.tabs.set(tabId, {
      ...tab,
      debugTransport: "scripting",
      debuggerAttached: false,
      state: "connected",
      errorText: reason,
    });
  }

  clearScriptingFallback(tabId: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.debugTransport !== "scripting") return;
    this.tabs.set(tabId, {
      ...tab,
      debugTransport: "debugger",
      errorText: undefined,
    });
  }

  private isDebuggerWedgeError(message: string): boolean {
    return (
      /chrome-extension:\/\//i.test(message) ||
      /another debugger/i.test(message) ||
      /Cannot access/i.test(message)
    );
  }

  /**
   * Ensure the Chrome debugger API is attached for CDP commands.
   * On password-manager wedge, falls back to scripting transport.
   */
  async ensureDebuggerAttached(tabId: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} is not registered`);
    }

    if (tab.debugTransport === "scripting") {
      return;
    }

    if (tab.debuggerAttached) return;

    // Refuse attach on non-http(s) pages before Chrome logs a red extension error.
    try {
      const live = await chrome.tabs.get(tabId);
      const liveUrl = live.url || live.pendingUrl || "";
      if (liveUrl && !this.isControllableUrl(liveUrl)) {
        throw new Error(
          `Cannot attach debugger to non-page URL: ${liveUrl.slice(0, 120)}`
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Cannot attach debugger")
      ) {
        throw error;
      }
      // tab may have closed; fall through to attach attempt
    }

    const debuggee = { tabId };
    this.logger.debug("Attaching debugger to tab:", tabId);

    // If a previous session is half-dead, detach first so attach is clean.
    try {
      await chrome.debugger.detach(debuggee);
    } catch {
      // not attached
    }
    await this.sleep(50);

    try {
      try {
        await chrome.debugger.attach(debuggee, "1.3");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already attached/i.test(message)) {
          // ok
        } else if (this.isDebuggerWedgeError(message)) {
          await this.sleep(300);
          try {
            await chrome.debugger.attach(debuggee, "1.3");
          } catch (retryErr) {
            const retryMsg =
              retryErr instanceof Error ? retryErr.message : String(retryErr);
            this.markScriptingFallback(tabId, retryMsg);
            return;
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isDebuggerWedgeError(message)) {
        this.markScriptingFallback(tabId, message);
        return;
      }
      throw error;
    }

    const current = this.tabs.get(tabId) ?? tab;
    this.tabs.set(tabId, {
      ...current,
      state: "connected",
      debuggerAttached: true,
      debugTransport: "debugger",
    });

    this.logger.log("Debugger attached:", tabId, "sessionId:", current.sessionId);
  }

  /**
   * Force detach + attach. Used when sendCommand fails after soft-detach with
   * "Cannot access a chrome-extension:// URL of different extension".
   */
  async forceReattach(tabId: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} is not registered`);
    }

    this.logger.debug("Force re-attaching debugger for tab:", tabId);
    this.tabs.set(tabId, {
      ...tab,
      debuggerAttached: false,
      debugTransport: "debugger",
    });
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // may already be detached
    }
    await this.waitForTabReady(tabId, 3000);
    await this.sleep(150);
    await this.ensureDebuggerAttached(tabId);
  }

  /**
   * Evaluate expression in page MAIN world via chrome.scripting (no debugger).
   * Returns a CDP-like Runtime.evaluate result shape.
   */
  async evaluateViaScripting(
    tabId: number,
    expression: string
  ): Promise<{ result: { type: string; value?: unknown; description?: string }; exceptionDetails?: { text: string } }> {
    if (!chrome.scripting?.executeScript) {
      throw new Error("chrome.scripting is unavailable");
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [expression],
      func: async (expr: string) => {
        try {
          // eslint-disable-next-line no-eval
          let value: unknown = (0, eval)(expr);
          if (value != null && typeof (value as { then?: unknown }).then === "function") {
            value = await value;
          }
          return { ok: true as const, value };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    });

    if (!result || typeof result !== "object") {
      return { result: { type: "undefined" } };
    }
    if ((result as { ok?: boolean }).ok === false) {
      const text = String((result as { error?: string }).error || "evaluate failed");
      return {
        result: { type: "undefined" },
        exceptionDetails: { text },
      };
    }
    const value = (result as { value?: unknown }).value;
    const type =
      value === null
        ? "object"
        : value === undefined
          ? "undefined"
          : typeof value;
    return { result: { type, value } };
  }

  /**
   * Detach a tab and clean up.
   */
  detach(tabId: number, shouldDetachDebugger: boolean): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.logger.debug("Detaching tab:", tabId);

    this.sendMessage({
      method: "forwardCDPEvent",
      params: {
        method: "Target.detachedFromTarget",
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    });

    this.tabs.delete(tabId);

    for (const [childSessionId, parentTabId] of this.childSessions) {
      if (parentTabId === tabId) {
        this.childSessions.delete(childSessionId);
      }
    }

    if (shouldDetachDebugger && tab.debuggerAttached) {
      chrome.debugger.detach({ tabId }).catch((err) => {
        this.logger.debug("Error detaching debugger:", err);
      });
    }
  }

  /**
   * Handle debugger detach event from Chrome.
   *
   * Soft detach: keep the tab registered so named-page mappings stay valid.
   * Chrome often reports `target_closed` during username/password-manager
   * activity or in-page navigations even when the tab is still open — only
   * hard-drop when the Chrome tab is truly gone.
   */
  async handleDebuggerDetach(
    tabId: number,
    reason?: `${chrome.debugger.DetachReason}` | string
  ): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    let tabStillOpen = false;
    try {
      await chrome.tabs.get(tabId);
      tabStillOpen = true;
    } catch {
      tabStillOpen = false;
    }

    // Only hard-drop when the tab is gone. `target_closed` alone is not enough
    // — password managers / frame navigations on username fields report it
    // while the tab lives on (ch-03 pageName about:blank churn).
    const hard = !tabStillOpen;
    this.logger.debug(
      `Debugger detach for tab ${tabId} reason=${reason || "unknown"} tabOpen=${tabStillOpen} hard=${hard}`
    );

    if (!hard) {
      this.tabs.set(tabId, {
        ...tab,
        debuggerAttached: false,
        state: "connected",
      });
      // Wait for password-manager / frame navigation to settle, then re-attach.
      // Immediate re-attach often hits "Cannot access a chrome-extension:// URL
      // of different extension" on the next Runtime.enable.
      try {
        const live = await this.waitForTabReady(tabId, 5000);
        if (!live) {
          this.logger.debug("Soft detach: tab disappeared while waiting");
          return;
        }
        await this.ensureDebuggerAttached(tabId);
        if (this.usesScriptingFallback(tabId)) {
          // Debugger attach wedged — scripting fallback already selected.
          const refreshed = this.tabs.get(tabId);
          if (refreshed?.targetInfo) {
            this.sendAttached(refreshed.sessionId!, refreshed.targetInfo);
          }
          return;
        }
        // Probe Runtime.enable; force re-attach / scripting if Chrome is wedged.
        try {
          await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
        } catch (probeErr) {
          const probeMsg =
            probeErr instanceof Error ? probeErr.message : String(probeErr);
          this.logger.debug(
            "Runtime.enable after soft re-attach failed; forceReattach",
            probeMsg
          );
          try {
            await this.forceReattach(tabId);
            if (!this.usesScriptingFallback(tabId)) {
              await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
            }
          } catch {
            this.markScriptingFallback(tabId, probeMsg);
          }
        }
        const refreshed = this.tabs.get(tabId);
        if (refreshed?.targetInfo) {
          try {
            const again = await chrome.tabs.get(tabId);
            refreshed.targetInfo = this.targetInfoFromTab(
              again,
              refreshed.targetId!
            );
            this.tabs.set(tabId, refreshed);
          } catch {
            // ignore
          }
          this.sendAttached(refreshed.sessionId!, refreshed.targetInfo);
        }
      } catch (err) {
        this.logger.debug(
          "Re-attach after soft detach failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
      return;
    }

    this.sendMessage({
      method: "forwardCDPEvent",
      params: {
        method: "Target.detachedFromTarget",
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    });

    for (const [childSessionId, parentTabId] of this.childSessions) {
      if (parentTabId === tabId) {
        this.childSessions.delete(childSessionId);
      }
    }

    this.tabs.delete(tabId);
  }

  /**
   * Clear all tabs and child sessions.
   */
  clear(): void {
    this.tabs.clear();
    this.childSessions.clear();
  }

  /**
   * Detach all tabs (used on disconnect).
   */
  detachAll(): void {
    for (const [tabId, tab] of this.tabs) {
      if (tab.debuggerAttached) {
        chrome.debugger.detach({ tabId }).catch(() => {});
      }
    }
    this.clear();
  }

  /**
   * Get all tab IDs.
   */
  getAllTabIds(): number[] {
    return Array.from(this.tabs.keys());
  }

  private targetInfoFromTab(tab: chrome.tabs.Tab, targetId: string): TargetInfo {
    return {
      targetId,
      type: "page",
      title: tab.title ?? "",
      url: tab.url ?? tab.pendingUrl ?? "",
      active: tab.active === true,
      focused: tab.id === this.lastFocusedTabId,
      windowId: tab.windowId,
      attached: true,
    };
  }

  private sendAttached(sessionId: string, targetInfo: TargetInfo): void {
    this.sendMessage({
      method: "forwardCDPEvent",
      params: {
        method: "Target.attachedToTarget",
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    });
  }
}
