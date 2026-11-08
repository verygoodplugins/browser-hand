import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { CDPRouter } from "../services/CDPRouter";
import { TabManager } from "../services/TabManager";
import type { Logger } from "../utils/logger";
import type { ExtensionCommandMessage, TransportMode } from "../utils/types";

const tabsGet = vi.fn();
const tabsUpdate = vi.fn();
const tabsCreate = vi.fn();
const executeScript = vi.fn();
const debuggerAttach = vi.fn();
const debuggerSendCommand = vi.fn();

function installChrome(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("chrome", {
    ...fakeBrowser,
    debugger: {
      attach: debuggerAttach,
      detach: vi.fn().mockResolvedValue(undefined),
      sendCommand: debuggerSendCommand,
    },
    tabs: {
      ...fakeBrowser.tabs,
      get: tabsGet,
      update: tabsUpdate,
      create: tabsCreate,
      remove: vi.fn(),
    },
    scripting: { executeScript },
    // No tabGroups / tabs.group: Search grants neither.
    ...overrides,
  });
}

const tab = (partial: Partial<chrome.tabs.Tab> & { id: number }) =>
  ({
    windowId: 1,
    active: false,
    url: "https://example.com/",
    status: "complete",
    ...partial,
  }) as chrome.tabs.Tab;

function command(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  return {
    id: 1,
    method: "forwardCDPCommand",
    params: { method, params, sessionId },
  } as ExtensionCommandMessage;
}

describe("debugger-free transport", () => {
  let mode: TransportMode;
  let manager: TabManager;
  let router: CDPRouter;
  let sendMessage: ReturnType<typeof vi.fn>;
  const logger: Logger = { log: vi.fn(), debug: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    fakeBrowser.reset();
    for (const fn of [
      tabsGet,
      tabsUpdate,
      tabsCreate,
      executeScript,
      debuggerAttach,
      debuggerSendCommand,
    ]) {
      fn.mockReset();
    }
    installChrome();
    // Run the injected func in-process, the way the page would.
    executeScript.mockImplementation(async ({ args, func }) => [{ result: await func(...args) }]);
    mode = "scripting";
    sendMessage = vi.fn();
    manager = new TabManager({ logger, sendMessage, getTransportMode: () => mode });
    router = new CDPRouter({ logger, tabManager: manager });
  });

  async function registerTab(id = 7) {
    const t = tab({ id });
    tabsGet.mockResolvedValue(t);
    await manager.register(t);
    return manager.get(id)!;
  }

  it("never touches chrome.debugger in the default scripting mode", async () => {
    const info = await registerTab();
    await router.handleCommand(command("Runtime.enable", {}, info.sessionId));
    const out = (await router.handleCommand(
      command("Runtime.evaluate", { expression: "1 + 2" }, info.sessionId)
    )) as { result: { value: number } };
    expect(out.result.value).toBe(3);
    expect(debuggerAttach).not.toHaveBeenCalled();
    expect(debuggerSendCommand).not.toHaveBeenCalled();
    expect(manager.usesScriptingFallback(7)).toBe(true);
    expect(manager.get(7)?.errorText).toBeUndefined();
  });

  it("falls back and remembers when chrome.debugger is a stub (Search)", async () => {
    mode = "debugger";
    debuggerAttach.mockRejectedValue(new Error("debugger.attach isn't available in Search"));
    await registerTab(7);
    await manager.ensureDebuggerAttached(7);
    expect(manager.usesScriptingFallback(7)).toBe(true);
    expect(manager.isDebuggerAvailable()).toBe(false);

    await registerTab(8);
    await manager.ensureDebuggerAttached(8);
    expect(debuggerAttach).toHaveBeenCalledTimes(1); // no second attempt
    expect((await manager.getTransportInfo()).effective).toBe("scripting");
  });

  it("treats a missing chrome.debugger as unavailable without calling it", async () => {
    installChrome({ debugger: undefined });
    mode = "debugger";
    await registerTab();
    await manager.ensureDebuggerAttached(7);
    expect(manager.usesScriptingFallback(7)).toBe(true);
    expect(manager.debuggerApiMissing()).toBe(true);
  });

  it("still attaches the debugger when the user opts in and it works", async () => {
    mode = "debugger";
    debuggerAttach.mockResolvedValue(undefined);
    await registerTab();
    await manager.ensureDebuggerAttached(7);
    expect(debuggerAttach).toHaveBeenCalledTimes(1);
    expect(manager.usesScriptingFallback(7)).toBe(false);
  });

  describe("pages whose CSP forbids eval", () => {
    const blocked = [
      { result: { ok: false, name: "EvalError", error: "Refused: 'unsafe-eval' is not allowed" } },
    ];

    it("injects the expression as script text through chrome.userScripts", async () => {
      const info = await registerTab();
      executeScript.mockResolvedValue(blocked);
      const execute = vi.fn().mockResolvedValue([{ result: { ok: true, value: "dom-ok" } }]);
      installChrome({ userScripts: { execute } });
      const out = (await router.handleCommand(
        command("Runtime.evaluate", { expression: "document.title" }, info.sessionId)
      )) as { result: { value: string } };
      expect(out.result.value).toBe("dom-ok");
      const injection = execute.mock.calls[0][0];
      expect(injection.world).toBe("MAIN");
      expect(injection.target).toEqual({ tabId: 7 });
      expect(injection.js[0].code).toContain("await(\ndocument.title\n)");
    });

    it("says how to unblock when userScripts is unavailable (no dead-end debugger advice)", async () => {
      const info = await registerTab();
      executeScript.mockResolvedValue(blocked);
      const out = (await router.handleCommand(
        command("Runtime.evaluate", { expression: "1" }, info.sessionId)
      )) as { exceptionDetails: { text: string } };
      expect(out.exceptionDetails.text).toMatch(/Allow User Scripts/);
    });
  });

  it("probes chrome.debugger without a tab and spots Search's stub", async () => {
    debuggerAttach.mockRejectedValue(new Error("debugger.attach isn't available in Search"));
    expect(manager.isDebuggerAvailable()).toBe(true); // unproven until probed
    await manager.probeDebugger();
    expect(debuggerAttach).toHaveBeenCalledWith({ tabId: -1 }, "1.3");
    expect(manager.isDebuggerAvailable()).toBe(false);
    expect((await manager.getTransportInfo()).debuggerUnavailableReason).toMatch(/Search/);
  });

  it("keeps real Chrome's debugger available after the probe", async () => {
    debuggerAttach.mockRejectedValue(new Error("No tab with given id -1."));
    await manager.probeDebugger();
    expect(manager.isDebuggerAvailable()).toBe(true);
    await manager.probeDebugger();
    expect(debuggerAttach).toHaveBeenCalledTimes(1); // probed once
  });

  it("reports eval exceptions the way the CLI reads them", async () => {
    const info = await registerTab();
    const out = (await router.handleCommand(
      command("Runtime.evaluate", { expression: "throw new Error('boom')" }, info.sessionId)
    )) as { exceptionDetails: { text: string; exception: { description: string } } };
    expect(out.exceptionDetails.text).toBe("boom");
    expect(out.exceptionDetails.exception.description).toBe("boom");
  });

  describe("Page.navigate via chrome.tabs", () => {
    it("updates the tab, waits for load, and reports loadComplete", async () => {
      const info = await registerTab();
      tabsUpdate.mockResolvedValue(undefined);
      tabsGet
        .mockResolvedValueOnce(tab({ id: 7, url: "about:blank", status: "complete" })) // before
        .mockResolvedValueOnce(tab({ id: 7, url: "https://example.com/next", status: "loading" }))
        .mockResolvedValue(tab({ id: 7, url: "https://example.com/next", status: "complete" }));
      vi.useFakeTimers();
      const pending = router.handleCommand(
        command("Page.navigate", { url: "https://example.com/next" }, info.sessionId)
      );
      await vi.advanceTimersByTimeAsync(500);
      const result = (await pending) as { loadComplete?: boolean; errorText?: string };
      expect(tabsUpdate).toHaveBeenCalledWith(7, { url: "https://example.com/next" });
      expect(result.loadComplete).toBe(true);
      expect(result.errorText).toBeUndefined();
      expect(debuggerSendCommand).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            method: "Page.loadEventFired",
            sessionId: info.sessionId,
          }),
        })
      );
      vi.useRealTimers();
    });

    it("returns immediately for a fragment-only navigation", async () => {
      const info = await registerTab();
      tabsUpdate.mockResolvedValue(undefined);
      tabsGet.mockResolvedValue(
        tab({ id: 7, url: "https://example.com/page", status: "complete" })
      );
      const result = (await router.handleCommand(
        command("Page.navigate", { url: "https://example.com/page#section" }, info.sessionId)
      )) as { loadComplete?: boolean };
      expect(result.loadComplete).toBe(true);
    });

    it("surfaces chrome-error pages as errorText", async () => {
      const info = await registerTab();
      tabsUpdate.mockResolvedValue(undefined);
      tabsGet
        .mockResolvedValueOnce(tab({ id: 7, url: "https://example.com/", status: "complete" }))
        .mockResolvedValue(
          tab({ id: 7, url: "chrome-error://chromewebdata/", status: "complete" })
        );
      const result = (await router.handleCommand(
        command("Page.navigate", { url: "https://nope.invalid/" }, info.sessionId)
      )) as { errorText?: string; loadComplete?: boolean };
      expect(result.errorText).toMatch(/net::ERR_FAILED/);
      expect(result.loadComplete).toBeUndefined();
    });
  });

  it("creates a named tab with no debugger and no tabGroups API", async () => {
    const created = tab({ id: 42, url: "about:blank", pendingUrl: "about:blank" });
    tabsCreate.mockResolvedValue(created);
    tabsGet.mockResolvedValue(created);
    const out = (await router.handleCommand(
      command("Target.createTarget", { url: "about:blank", groupTitle: "Demo" })
    )) as { targetId: string };
    expect(out.targetId).toBe("tab-42");
    expect(manager.usesScriptingFallback(42)).toBe(true);
    expect(debuggerAttach).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it("DevBrowser.groupTarget degrades to ungrouped instead of failing", async () => {
    await registerTab(7);
    const out = await router.handleCommand(
      command("DevBrowser.groupTarget", { targetId: "tab-7" })
    );
    expect(out).toEqual({ groupId: null });
  });

  it("reports the transport via DevBrowser.getCapabilities", async () => {
    const out = (await router.handleCommand(command("DevBrowser.getCapabilities"))) as {
      mode: string;
      effective: string;
      debuggerAvailable: boolean;
    };
    expect(out).toMatchObject({
      mode: "scripting",
      effective: "scripting",
      debuggerAvailable: true,
    });
  });

  it("gives a clear error for CDP methods the scripting transport cannot emulate", async () => {
    const info = await registerTab();
    await expect(
      router.handleCommand(command("Input.dispatchMouseEvent", {}, info.sessionId))
    ).rejects.toThrow(/not supported by the debugger-free transport/);
  });
});
