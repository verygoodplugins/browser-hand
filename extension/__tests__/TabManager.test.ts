import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { TabManager } from "../services/TabManager";
import type { Logger } from "../utils/logger";

const mockTabsQuery = vi.fn();
const mockTabsGet = vi.fn();
const mockExecuteScript = vi.fn();

vi.stubGlobal("chrome", {
  ...fakeBrowser,
  tabs: {
    ...fakeBrowser.tabs,
    query: mockTabsQuery,
    get: mockTabsGet,
  },
  scripting: {
    executeScript: mockExecuteScript,
  },
});

function chromeTab(partial: Partial<chrome.tabs.Tab> & { id: number }): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    title: `Tab ${partial.id}`,
    url: `https://example.com/${partial.id}`,
    active: false,
    ...partial,
  } as chrome.tabs.Tab;
}

describe("TabManager", () => {
  let tabManager: TabManager;
  let mockLogger: Logger;
  let mockSendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeBrowser.reset();
    mockTabsQuery.mockReset();
    mockTabsGet.mockReset();
    mockExecuteScript.mockReset();
    mockExecuteScript.mockImplementation(async ({ args, func }: { args: [string]; func: (expr: string) => unknown }) => {
      const value = await func(args[0]);
      return [{ result: value }];
    });

    mockLogger = {
      log: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    mockSendMessage = vi.fn();

    tabManager = new TabManager({
      logger: mockLogger,
      sendMessage: mockSendMessage,
    });
  });

  describe("getBySessionId", () => {
    it("should return undefined when no tabs exist", () => {
      const result = tabManager.getBySessionId("session-1");
      expect(result).toBeUndefined();
    });

    it("should find tab by session ID", () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });

      const result = tabManager.getBySessionId("session-1");
      expect(result).toEqual({
        tabId: 123,
        tab: {
          sessionId: "session-1",
          targetId: "target-1",
          state: "connected",
        },
      });
    });
  });

  describe("getByTargetId", () => {
    it("should return undefined when no tabs exist", () => {
      const result = tabManager.getByTargetId("target-1");
      expect(result).toBeUndefined();
    });

    it("should find tab by target ID", () => {
      tabManager.set(456, {
        sessionId: "session-2",
        targetId: "target-2",
        state: "connected",
      });

      const result = tabManager.getByTargetId("target-2");
      expect(result).toEqual({
        tabId: 456,
        tab: {
          sessionId: "session-2",
          targetId: "target-2",
          state: "connected",
        },
      });
    });
  });

  describe("child sessions", () => {
    it("should track child sessions", () => {
      tabManager.trackChildSession("child-session-1", 123);
      expect(tabManager.getParentTabId("child-session-1")).toBe(123);
    });

    it("should untrack child sessions", () => {
      tabManager.trackChildSession("child-session-1", 123);
      tabManager.untrackChildSession("child-session-1");
      expect(tabManager.getParentTabId("child-session-1")).toBeUndefined();
    });
  });

  describe("set/get/has", () => {
    it("should set and get tab info", () => {
      tabManager.set(789, { state: "connecting" });
      expect(tabManager.get(789)).toEqual({ state: "connecting" });
      expect(tabManager.has(789)).toBe(true);
    });

    it("should return undefined for unknown tabs", () => {
      expect(tabManager.get(999)).toBeUndefined();
      expect(tabManager.has(999)).toBe(false);
    });
  });

  describe("detach", () => {
    it("should send detached event and remove tab", () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });

      tabManager.detach(123, false);

      expect(mockSendMessage).toHaveBeenCalledWith({
        method: "forwardCDPEvent",
        params: {
          method: "Target.detachedFromTarget",
          params: { sessionId: "session-1", targetId: "target-1" },
        },
      });

      expect(tabManager.has(123)).toBe(false);
    });

    it("should clean up child sessions when detaching", () => {
      tabManager.set(123, {
        sessionId: "session-1",
        targetId: "target-1",
        state: "connected",
      });
      tabManager.trackChildSession("child-1", 123);
      tabManager.trackChildSession("child-2", 123);

      tabManager.detach(123, false);

      expect(tabManager.getParentTabId("child-1")).toBeUndefined();
      expect(tabManager.getParentTabId("child-2")).toBeUndefined();
    });

    it("should do nothing for unknown tabs", () => {
      tabManager.detach(999, false);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("should clear all tabs and child sessions", () => {
      tabManager.set(1, { state: "connected" });
      tabManager.set(2, { state: "connected" });
      tabManager.trackChildSession("child-1", 1);

      tabManager.clear();

      expect(tabManager.has(1)).toBe(false);
      expect(tabManager.has(2)).toBe(false);
      expect(tabManager.getParentTabId("child-1")).toBeUndefined();
    });
  });

  describe("getAllTabIds", () => {
    it("should return all tab IDs", () => {
      tabManager.set(1, { state: "connected" });
      tabManager.set(2, { state: "connecting" });
      tabManager.set(3, { state: "error" });

      const ids = tabManager.getAllTabIds();
      expect(ids).toEqual([1, 2, 3]);
    });
  });

  describe("listTargets / focused tab", () => {
    it("marks the last-focused window's active tab as focused", async () => {
      const tabs = [
        chromeTab({ id: 1, title: "Gmail", url: "https://mail.google.com/", active: true, windowId: 1 }),
        chromeTab({
          id: 2,
          title: "Stripe",
          url: "https://dashboard.stripe.com/",
          active: true,
          windowId: 2,
        }),
        chromeTab({ id: 3, title: "Docs", url: "https://docs.example/", active: false, windowId: 2 }),
      ];
      mockTabsQuery.mockImplementation(async (query: chrome.tabs.QueryInfo = {}) => {
        if (query.lastFocusedWindow && query.active) {
          return [tabs[1]];
        }
        return tabs;
      });

      const infos = await tabManager.listTargets();
      expect(infos).toHaveLength(3);
      const stripe = infos.find((info) => info.targetId === "tab-2");
      const gmail = infos.find((info) => info.targetId === "tab-1");
      expect(stripe).toMatchObject({
        title: "Stripe",
        active: true,
        focused: true,
        windowId: 2,
      });
      expect(gmail).toMatchObject({
        title: "Gmail",
        active: true,
        focused: false,
      });
    });

    it("keeps last-focused tab when Chrome has no focused window", async () => {
      mockTabsQuery.mockImplementation(async (query: chrome.tabs.QueryInfo = {}) => {
        if (query.lastFocusedWindow) {
          throw new Error("No last focused window");
        }
        return [
          chromeTab({ id: 9, title: "Stripe", url: "https://dashboard.stripe.com/", active: true }),
        ];
      });
      mockTabsGet.mockResolvedValue(
        chromeTab({ id: 9, title: "Stripe", url: "https://dashboard.stripe.com/", active: true })
      );

      await tabManager.markActiveTab(9);
      const infos = await tabManager.listTargets();
      expect(infos[0]).toMatchObject({
        targetId: "tab-9",
        focused: true,
        active: true,
      });
    });
  });

  describe("evaluateViaScripting", () => {
    it("returns synchronous eval results", async () => {
      const result = await tabManager.evaluateViaScripting(1, "1 + 1");
      expect(result.result.value).toBe(2);
    });

    it("awaits thenable eval results so async fill/type expressions settle", async () => {
      const result = await tabManager.evaluateViaScripting(1, "(async () => 7)()");
      expect(result.result.value).toBe(7);
    });
  });
});
