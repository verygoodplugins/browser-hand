import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { CDPRouter } from "../services/CDPRouter";
import { TabManager } from "../services/TabManager";
import type { Logger } from "../utils/logger";
import type { ExtensionCommandMessage } from "../utils/types";

// Mock chrome.debugger since fakeBrowser doesn't include it
const mockDebuggerSendCommand = vi.fn();
const mockTabsUpdate = vi.fn();
const mockTabsGet = vi.fn();
const mockTabsCreate = vi.fn();
const mockTabsGroup = vi.fn();
const mockTabsRemove = vi.fn();
const mockTabGroupsGet = vi.fn();
const mockTabGroupsUpdate = vi.fn();
const mockWindowsUpdate = vi.fn();

vi.stubGlobal("chrome", {
  ...fakeBrowser,
  debugger: {
    sendCommand: mockDebuggerSendCommand,
    attach: vi.fn(),
    detach: vi.fn(),
    onEvent: { addListener: vi.fn(), hasListener: vi.fn() },
    onDetach: { addListener: vi.fn(), hasListener: vi.fn() },
    getTargets: vi.fn().mockResolvedValue([]),
  },
  tabs: {
    ...fakeBrowser.tabs,
    update: mockTabsUpdate,
    get: mockTabsGet,
    create: mockTabsCreate,
    group: mockTabsGroup,
    remove: mockTabsRemove,
  },
  tabGroups: {
    get: mockTabGroupsGet,
    update: mockTabGroupsUpdate,
  },
  windows: {
    ...fakeBrowser.windows,
    update: mockWindowsUpdate,
  },
});

describe("CDPRouter", () => {
  let cdpRouter: CDPRouter;
  let tabManager: TabManager;
  let mockLogger: Logger;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let focusPolicy: "background" | "tab" | "window";

  beforeEach(() => {
    fakeBrowser.reset();
    mockDebuggerSendCommand.mockReset();
    mockTabsUpdate.mockReset();
    mockTabsGet.mockReset();
    mockTabsCreate.mockReset();
    mockTabsGroup.mockReset();
    mockTabsRemove.mockReset();
    mockTabGroupsGet.mockReset();
    mockTabGroupsUpdate.mockReset();
    mockWindowsUpdate.mockReset();
    focusPolicy = "background";

    mockLogger = {
      log: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    mockSendMessage = vi.fn();
    mockTabsGet.mockResolvedValue({ id: 123, windowId: 9 });
    mockTabsUpdate.mockResolvedValue({});
    mockWindowsUpdate.mockResolvedValue({});

    tabManager = new TabManager({
      logger: mockLogger,
      sendMessage: mockSendMessage,
    });

    cdpRouter = new CDPRouter({
      logger: mockLogger,
      tabManager,
      getFocusPolicy: () => focusPolicy,
    });
  });

  describe("handleCommand", () => {
    it("lists live targets without requiring a session", async () => {
      const listTargets = vi.spyOn(tabManager, "listTargets").mockResolvedValue([
        {
          targetId: "tab-9",
          type: "page",
          title: "Stripe",
          url: "https://dashboard.stripe.com/",
          active: true,
          focused: true,
          windowId: 2,
          attached: true,
        },
      ]);

      const result = await cdpRouter.handleCommand({
        id: 1,
        method: "forwardCDPCommand",
        params: { method: "DevBrowser.listTargets" },
      });

      expect(listTargets).toHaveBeenCalledOnce();
      expect(result).toEqual({
        targetInfos: [
          expect.objectContaining({
            targetId: "tab-9",
            focused: true,
            active: true,
          }),
        ],
      });
    });

    it("should return early for non-forwardCDPCommand methods", async () => {
      const msg = {
        id: 1,
        method: "someOtherMethod" as const,
        params: { method: "Test.method" },
      };

      // @ts-expect-error - testing invalid method
      const result = await cdpRouter.handleCommand(msg);
      expect(result).toBeUndefined();
    });

    it("should throw error when no tab found for command", async () => {
      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Page.navigate",
          sessionId: "unknown-session",
        },
      };

      await expect(cdpRouter.handleCommand(msg)).rejects.toThrow(
        "No tab found for method Page.navigate"
      );
    });

    it("should find tab by sessionId", async () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });

      mockDebuggerSendCommand.mockResolvedValue({ result: "ok" });

      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Page.navigate",
          sessionId: "session-1",
          params: { url: "https://example.com" },
        },
      };

      await cdpRouter.handleCommand(msg);

      expect(mockDebuggerSendCommand).toHaveBeenCalledWith(
        { tabId: 123, sessionId: undefined },
        "Page.navigate",
        { url: "https://example.com" }
      );
    });

    it("should find tab via child session", async () => {
      tabManager.set(123, {
        sessionId: "parent-session",
        targetId: "target-1",
        state: "connected",
      });
      tabManager.trackChildSession("child-session", 123);

      mockDebuggerSendCommand.mockResolvedValue({});

      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Runtime.evaluate",
          sessionId: "child-session",
        },
      };

      await cdpRouter.handleCommand(msg);

      expect(mockDebuggerSendCommand).toHaveBeenCalledWith(
        { tabId: 123, sessionId: "child-session" },
        "Runtime.evaluate",
        undefined
      );
    });

    it("creates a replacement group when a cached group cannot be reused", async () => {
      mockTabsCreate
        .mockResolvedValueOnce({ id: 41, url: "https://example.com/a" })
        .mockResolvedValueOnce({ id: 42, url: "https://example.com/b" })
        .mockResolvedValueOnce({ id: 43, url: "https://example.com/c" });
      mockTabsGroup.mockImplementation(async (options: { tabIds: number[]; groupId?: number }) => {
        if (options.groupId === 7) {
          throw new Error("No tab group with id: 7.");
        }
        if (options.groupId != null) return options.groupId;
        return options.tabIds[0] === 41 ? 7 : 8;
      });
      mockTabGroupsGet.mockImplementation(async (groupId: number) => ({
        id: groupId,
        title: "Browser Hand",
      }));
      mockTabGroupsUpdate.mockResolvedValue({});
      vi.spyOn(tabManager, "register").mockImplementation(async (tab) => ({
        targetId: `tab-${tab.id}`,
        type: "page",
        title: "",
        url: tab.url ?? "",
        attached: false,
      }));
      vi.spyOn(tabManager, "attach").mockImplementation(async (tabId) => ({
        targetId: `tab-${tabId}`,
        type: "page",
        title: "",
        url: "",
        attached: true,
      }));

      const open = (url: string) =>
        cdpRouter.handleCommand({
          id: 1,
          method: "forwardCDPCommand",
          params: { method: "Target.createTarget", params: { url } },
        });

      await expect(open("https://example.com/a")).resolves.toEqual({ targetId: "tab-41" });
      await expect(open("https://example.com/b")).resolves.toEqual({ targetId: "tab-42" });
      await expect(open("https://example.com/c")).resolves.toEqual({ targetId: "tab-43" });

      expect(mockTabGroupsGet).toHaveBeenCalledWith(7);
      expect(mockTabsGroup).toHaveBeenNthCalledWith(1, {
        tabIds: [41],
        createProperties: { windowId: 9 },
      });
      expect(mockTabsGroup).toHaveBeenNthCalledWith(2, { tabIds: [42], groupId: 7 });
      expect(mockTabsGroup).toHaveBeenNthCalledWith(3, {
        tabIds: [42],
        createProperties: { windowId: 9 },
      });
      expect(mockTabsGroup).toHaveBeenNthCalledWith(4, { tabIds: [43], groupId: 8 });
      expect(mockTabGroupsUpdate).toHaveBeenNthCalledWith(
        2,
        8,
        expect.objectContaining({ title: "Browser Hand" })
      );
      expect(mockTabsRemove).not.toHaveBeenCalled();
    });
  });

  describe("focus policy", () => {
    beforeEach(() => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });
    });

    it("does not activate tab or focus window for activateTarget in background mode", async () => {
      focusPolicy = "background";
      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Target.activateTarget",
          sessionId: "session-1",
          params: { targetId: "target-1" },
        },
      };

      await cdpRouter.handleCommand(msg);

      expect(mockTabsUpdate).not.toHaveBeenCalled();
      expect(mockWindowsUpdate).not.toHaveBeenCalled();
    });

    it("activates tab only for focusPolicy=tab", async () => {
      focusPolicy = "tab";
      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Target.activateTarget",
          sessionId: "session-1",
          params: { targetId: "target-1" },
        },
      };

      await cdpRouter.handleCommand(msg);

      expect(mockTabsUpdate).toHaveBeenCalledWith(123, { active: true });
      expect(mockWindowsUpdate).not.toHaveBeenCalled();
    });

    it("activates tab and focuses window for focusPolicy=window", async () => {
      focusPolicy = "window";
      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Target.activateTarget",
          sessionId: "session-1",
          params: { targetId: "target-1" },
        },
      };

      await cdpRouter.handleCommand(msg);

      expect(mockTabsUpdate).toHaveBeenCalledWith(123, { active: true });
      expect(mockWindowsUpdate).toHaveBeenCalledWith(9, { focused: true });
    });

    it("treats Page.bringToFront like activate under focus policy", async () => {
      focusPolicy = "background";
      const msg: ExtensionCommandMessage = {
        id: 1,
        method: "forwardCDPCommand",
        params: {
          method: "Page.bringToFront",
          sessionId: "session-1",
        },
      };

      await cdpRouter.handleCommand(msg);

      expect(mockTabsUpdate).not.toHaveBeenCalled();
      expect(mockWindowsUpdate).not.toHaveBeenCalled();
      expect(mockDebuggerSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("handleDebuggerEvent", () => {
    it("should forward CDP events to relay", () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });

      const sendMessage = vi.fn();

      cdpRouter.handleDebuggerEvent(
        { tabId: 123 },
        "Page.loadEventFired",
        { timestamp: 12345 },
        sendMessage
      );

      expect(sendMessage).toHaveBeenCalledWith({
        method: "forwardCDPEvent",
        params: {
          sessionId: "session-1",
          method: "Page.loadEventFired",
          params: { timestamp: 12345 },
        },
      });
    });

    it("should track child sessions on Target.attachedToTarget", () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });

      const sendMessage = vi.fn();

      cdpRouter.handleDebuggerEvent(
        { tabId: 123 },
        "Target.attachedToTarget",
        { sessionId: "new-child-session", targetInfo: {} },
        sendMessage
      );

      expect(tabManager.getParentTabId("new-child-session")).toBe(123);
    });

    it("should untrack child sessions on Target.detachedFromTarget", () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });
      tabManager.trackChildSession("child-session", 123);

      const sendMessage = vi.fn();

      cdpRouter.handleDebuggerEvent(
        { tabId: 123 },
        "Target.detachedFromTarget",
        { sessionId: "child-session" },
        sendMessage
      );

      expect(tabManager.getParentTabId("child-session")).toBeUndefined();
    });

    it("should ignore events for unknown tabs", () => {
      const sendMessage = vi.fn();

      cdpRouter.handleDebuggerEvent({ tabId: 999 }, "Page.loadEventFired", {}, sendMessage);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("groups an existing target under the requested title", async () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });
      const group = vi.fn(async () => 11);
      const update = vi.fn(async () => ({}));
      const get = vi.fn(async () => {
        throw new Error("No tab group");
      });
      const tabs = chrome.tabs as typeof chrome.tabs & { group?: typeof group };
      const previousGroup = tabs.group;
      const previousTabGroups = (chrome as typeof chrome & { tabGroups?: unknown }).tabGroups;
      tabs.group = group;
      (chrome as typeof chrome & { tabGroups?: unknown }).tabGroups = { get, update };
      try {
        const result = await cdpRouter.handleCommand({
          id: 1,
          method: "forwardCDPCommand",
          params: {
            method: "DevBrowser.groupTarget",
            params: { targetId: "target-1", groupTitle: "DNS records" },
          },
        });
        expect(result).toEqual({ groupId: 11 });
        expect(group).toHaveBeenCalledWith({
          tabIds: [123],
          createProperties: { windowId: 9 },
        });
        expect(update).toHaveBeenCalledWith(
          11,
          expect.objectContaining({ title: "DNS records" })
        );
      } finally {
        tabs.group = previousGroup;
        (chrome as typeof chrome & { tabGroups?: unknown }).tabGroups = previousTabGroups;
      }
    });

    it("reuses a stored group title after the worker restarts", async () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });
      const known = new Map<number, string>();
      const group = vi.fn(async (opts: { groupId?: number }) => opts.groupId ?? 11);
      const update = vi.fn(async (id: number, info: { title?: string }) => {
        if (info?.title) known.set(id, info.title);
      });
      const get = vi.fn(async (id: number) => {
        const title = known.get(id);
        if (!title) throw new Error("No tab group");
        return { id, title };
      });
      const tabs = chrome.tabs as typeof chrome.tabs & { group?: typeof group };
      const previousGroup = tabs.group;
      const previousTabGroups = (chrome as typeof chrome & { tabGroups?: unknown }).tabGroups;
      tabs.group = group;
      (chrome as typeof chrome & { tabGroups?: unknown }).tabGroups = { get, update };
      const command = {
        id: 1,
        method: "forwardCDPCommand" as const,
        params: {
          method: "DevBrowser.groupTarget",
          params: { targetId: "target-1", groupTitle: "DNS records" },
        },
      };
      try {
        await cdpRouter.handleCommand(command);
        const restarted = new CDPRouter({
          logger: mockLogger,
          tabManager,
          getFocusPolicy: () => focusPolicy,
        });
        const result = await restarted.handleCommand({ ...command, id: 2 });
        expect(result).toEqual({ groupId: 11 });
        expect(group).toHaveBeenLastCalledWith({ tabIds: [123], groupId: 11 });
      } finally {
        tabs.group = previousGroup;
        (chrome as typeof chrome & { tabGroups?: unknown }).tabGroups = previousTabGroups;
      }
    });
  });
});
