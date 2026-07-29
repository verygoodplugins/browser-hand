import { describe, it, expect, beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { StateManager } from "../services/StateManager";

describe("StateManager", () => {
  let stateManager: StateManager;

  beforeEach(() => {
    fakeBrowser.reset();
    stateManager = new StateManager();
  });

  describe("getState", () => {
    it("should return default active + background focus when no stored state", async () => {
      const state = await stateManager.getState();
      expect(state).toEqual({ isActive: true, focusPolicy: "background" });
    });

    it("should return stored state when available and fill missing focusPolicy", async () => {
      await fakeBrowser.storage.local.set({
        devBrowserActiveState: { isActive: true },
      });

      const state = await stateManager.getState();
      expect(state).toEqual({ isActive: true, focusPolicy: "background" });
    });

    it("should preserve a stored window focus policy", async () => {
      await fakeBrowser.storage.local.set({
        devBrowserActiveState: { isActive: true, focusPolicy: "window" },
      });

      const state = await stateManager.getState();
      expect(state.focusPolicy).toBe("window");
    });
  });

  describe("setState", () => {
    it("should persist state to storage with default focus policy", async () => {
      await stateManager.setState({ isActive: true });

      const stored = await fakeBrowser.storage.local.get("devBrowserActiveState");
      expect(stored.devBrowserActiveState).toEqual({
        isActive: true,
        focusPolicy: "background",
      });
    });

    it("should update state from active to inactive", async () => {
      await stateManager.setState({ isActive: true });
      await stateManager.setState({ isActive: false });

      const state = await stateManager.getState();
      expect(state).toEqual({ isActive: false, focusPolicy: "background" });
    });

    it("should update focus policy without clearing isActive", async () => {
      await stateManager.setState({ isActive: true });
      await stateManager.setState({ focusPolicy: "tab" });

      const state = await stateManager.getState();
      expect(state).toEqual({ isActive: true, focusPolicy: "tab" });
    });
  });

  describe("focus override", () => {
    it("effective policy uses one-shot override then falls back", async () => {
      await stateManager.setState({ focusPolicy: "background" });
      expect(await stateManager.getEffectiveFocusPolicy()).toBe("background");

      await stateManager.setFocusOverride({
        policy: "window",
        reason: "2fa",
        ttlMs: 60_000,
        consumeOnUse: true,
      });
      expect(await stateManager.getEffectiveFocusPolicy()).toBe("window");

      await stateManager.consumeFocusOverrideIfNeeded();
      expect(await stateManager.getEffectiveFocusPolicy()).toBe("background");
    });
  });
});
