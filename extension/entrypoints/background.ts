/**
 * dev-browser Chrome Extension Background Script
 *
 * This extension connects to the dev-browser relay server and allows
 * Playwright automation of the user's existing browser tabs.
 */

import { createLogger } from "../utils/logger";
import { TabManager } from "../services/TabManager";
import { ConnectionManager } from "../services/ConnectionManager";
import { CDPRouter } from "../services/CDPRouter";
import { StateManager } from "../services/StateManager";
import type { PopupMessage, StateResponse } from "../utils/types";

export default defineBackground(() => {
  // Create connection manager first (needed for sendMessage)
  let connectionManager: ConnectionManager;

  // Create logger with sendMessage function
  const logger = createLogger((msg) => connectionManager?.send(msg));

  // Create state manager for persistence
  const stateManager = new StateManager();

  // Create tab manager
  const tabManager = new TabManager({
    logger,
    sendMessage: (msg) => connectionManager.send(msg),
  });

  // Create CDP router (background focus by default — do not steal OS focus;
  // agents may set a one-shot override via DevBrowser.setFocusOverride)
  const cdpRouter = new CDPRouter({
    logger,
    tabManager,
    getFocusPolicy: () => stateManager.getEffectiveFocusPolicy(),
    consumeFocusOverride: () => stateManager.consumeFocusOverrideIfNeeded(),
    setFocusOverride: (opts) => stateManager.setFocusOverride(opts),
    clearFocusOverride: () => stateManager.clearFocusOverride(),
  });

  // Create connection manager
  connectionManager = new ConnectionManager({
    logger,
    onMessage: (msg) => cdpRouter.handleCommand(msg),
    onConnect: () => tabManager.syncExistingTabs(),
    onDisconnect: () => tabManager.detachAll(),
  });

  // Update badge to show active/inactive state
  function updateBadge(isActive: boolean): void {
    chrome.action.setBadgeText({ text: isActive ? "ON" : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
  }

  // Handle state changes
  async function handleStateChange(isActive: boolean): Promise<void> {
    await stateManager.setState({ isActive });
    if (isActive) {
      connectionManager.startMaintaining();
    } else {
      connectionManager.disconnect();
    }
    updateBadge(isActive);
  }

  async function buildStateResponse(): Promise<StateResponse> {
    const state = await stateManager.getState();
    const isConnected = await connectionManager.checkConnection();
    return {
      isActive: state.isActive,
      isConnected,
      focusPolicy: state.focusPolicy,
    };
  }

  // Handle debugger events
  function onDebuggerEvent(
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown
  ): void {
    cdpRouter.handleDebuggerEvent(source, method, params, (msg) => connectionManager.send(msg));
  }

  function onDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: `${chrome.debugger.DetachReason}`
  ): void {
    const tabId = source.tabId;
    if (!tabId) return;

    logger.debug(`Debugger detached for tab ${tabId}: ${reason}`);
    tabManager.handleDebuggerDetach(tabId, reason).catch((err) => {
      logger.debug("handleDebuggerDetach error:", err);
    });
  }

  // Handle messages from popup
  chrome.runtime.onMessage.addListener(
    (
      message: PopupMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: StateResponse) => void
    ) => {
      if (message.type === "getState") {
        (async () => {
          sendResponse(await buildStateResponse());
        })();
        return true; // Async response
      }

      if (message.type === "setState") {
        (async () => {
          if (typeof message.isActive === "boolean") {
            await handleStateChange(message.isActive);
          }
          if (message.focusPolicy) {
            await stateManager.setState({ focusPolicy: message.focusPolicy });
          }
          sendResponse(await buildStateResponse());
        })();
        return true; // Async response
      }

      return false;
    }
  );

  // Set up event listeners

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabManager.has(tabId)) {
      logger.debug("Tab closed:", tabId);
      tabManager.detach(tabId, false);
    }
  });

  chrome.tabs.onCreated.addListener((tab) => {
    tabManager.register(tab).catch((error) => {
      logger.debug("Error registering created tab:", error);
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && !changeInfo.title && changeInfo.status !== "complete") {
      return;
    }
    tabManager.register(tab).catch((error) => {
      logger.debug("Error registering updated tab:", tabId, error);
    });
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    tabManager.markActiveTab(activeInfo.tabId).catch((error) => {
      logger.debug("Error marking active tab:", activeInfo.tabId, error);
    });
  });

  // Register debugger event listeners
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);

  // Reset any stale debugger connections on startup
  chrome.debugger.getTargets().then((targets) => {
    const attached = targets.filter((t) => t.tabId && t.attached);
    if (attached.length > 0) {
      logger.log(`Detaching ${attached.length} stale debugger connections`);
      for (const target of attached) {
        chrome.debugger.detach({ tabId: target.tabId }).catch(() => {});
      }
    }
  });

  // MV3 keepalive. The setTimeout-based reconnect loop dies with the service
  // worker, so once Chrome kills the idle worker (~30s) nothing recovers until
  // the toolbar icon is clicked. Alarms persist across worker shutdown AND wake
  // the worker when they fire, so this re-asserts the relay connection every
  // ~30s and on browser startup with no manual toggle. The connecting-guard in
  // ConnectionManager keeps this from racing the stored-state init into a
  // double connect.
  const KEEPALIVE_ALARM = "dev-browser-keepalive";

  async function ensureConnectionIfActive(): Promise<void> {
    const { isActive } = await stateManager.getState();
    if (isActive && !connectionManager.isMaintaining()) {
      connectionManager.startMaintaining();
    }
  }

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      ensureConnectionIfActive().catch(() => {});
    }
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    ensureConnectionIfActive().catch(() => {});
  });

  logger.log("Extension initialized");

  // Initialize from stored state
  stateManager.getState().then((state) => {
    updateBadge(state.isActive);
    if (state.isActive) {
      connectionManager.startMaintaining();
    }
  });
});
