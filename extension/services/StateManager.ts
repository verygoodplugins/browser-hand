/**
 * StateManager - Manages extension active/inactive state with persistence.
 */

import type { FocusPolicy } from "../utils/types";

const STORAGE_KEY = "devBrowserActiveState";
const OVERRIDE_KEY = "devBrowserFocusOverride";

export interface ExtensionState {
  isActive: boolean;
  /**
   * background (default): never activate tabs or focus Chrome windows.
   * tab: switch to the target tab inside its window, but do not focus the window.
   * window: previous behavior — activate tab and focus the Chrome window.
   */
  focusPolicy: FocusPolicy;
}

/** One-shot / TTL agent override of the popup focus policy. */
export interface FocusOverride {
  policy: FocusPolicy;
  reason?: string;
  /** ISO timestamp; override ignored after this. */
  expiresAt: string;
  /** If true, clear after the next successful applyFocusPolicy. */
  consumeOnUse: boolean;
}

const DEFAULT_STATE: ExtensionState = {
  isActive: true,
  focusPolicy: "background",
};

function normalizeFocusPolicy(value: unknown): FocusPolicy {
  if (value === "tab" || value === "window" || value === "background") {
    return value;
  }
  return DEFAULT_STATE.focusPolicy;
}

export class StateManager {
  /**
   * Get the current extension state.
   * Defaults to active so loading the unpacked extension immediately connects
   * to the local AutoHub relay. Focus policy defaults to background so agents
   * do not yank the OS focus away from the user's editor/terminal.
   */
  async getState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const state = result[STORAGE_KEY] as Partial<ExtensionState> | undefined;
    return {
      isActive: state?.isActive ?? DEFAULT_STATE.isActive,
      focusPolicy: normalizeFocusPolicy(state?.focusPolicy),
    };
  }

  /**
   * Set the extension state (merged with existing).
   */
  async setState(partial: Partial<ExtensionState>): Promise<ExtensionState> {
    const current = await this.getState();
    const next: ExtensionState = {
      isActive: partial.isActive ?? current.isActive,
      focusPolicy:
        partial.focusPolicy !== undefined
          ? normalizeFocusPolicy(partial.focusPolicy)
          : current.focusPolicy,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async getFocusPolicy(): Promise<FocusPolicy> {
    return (await this.getState()).focusPolicy;
  }

  /**
   * Effective policy for activateTarget / bringToFront: live override if still
   * valid, else the popup/default focusPolicy.
   */
  async getEffectiveFocusPolicy(): Promise<FocusPolicy> {
    const override = await this.getFocusOverride();
    if (override) return override.policy;
    return this.getFocusPolicy();
  }

  async getFocusOverride(): Promise<FocusOverride | null> {
    const result = await chrome.storage.local.get(OVERRIDE_KEY);
    const raw = result[OVERRIDE_KEY] as FocusOverride | undefined;
    if (!raw || !raw.expiresAt) return null;
    if (Date.parse(raw.expiresAt) <= Date.now()) {
      await this.clearFocusOverride();
      return null;
    }
    return {
      policy: normalizeFocusPolicy(raw.policy),
      reason: raw.reason,
      expiresAt: raw.expiresAt,
      consumeOnUse: raw.consumeOnUse !== false,
    };
  }

  /**
   * Agent one-shot override. Does not change the popup default.
   */
  async setFocusOverride(opts: {
    policy: FocusPolicy | string;
    reason?: string;
    ttlMs?: number;
    consumeOnUse?: boolean;
  }): Promise<FocusOverride> {
    const ttlMs =
      typeof opts.ttlMs === "number" && Number.isFinite(opts.ttlMs)
        ? Math.max(1_000, Math.min(30 * 60_000, opts.ttlMs))
        : 120_000;
    const override: FocusOverride = {
      policy: normalizeFocusPolicy(opts.policy),
      reason: opts.reason ? String(opts.reason).slice(0, 240) : undefined,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      consumeOnUse: opts.consumeOnUse !== false,
    };
    await chrome.storage.local.set({ [OVERRIDE_KEY]: override });
    return override;
  }

  async clearFocusOverride(): Promise<void> {
    await chrome.storage.local.remove(OVERRIDE_KEY);
  }

  /**
   * Clear override after a successful focus apply when consumeOnUse is set.
   */
  async consumeFocusOverrideIfNeeded(): Promise<void> {
    const override = await this.getFocusOverride();
    if (override?.consumeOnUse) {
      await this.clearFocusOverride();
    }
  }
}
