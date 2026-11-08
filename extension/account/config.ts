/**
 * Public Clerk configuration inlined into the extension at build time.
 *
 * Only `WXT_` variables are read. The instance secret stays in the Node brand
 * script; a `WXT_`-prefixed secret would be inlined into the extension bundle.
 */

export interface PublicClerkEnv {
  WXT_CLERK_PUBLISHABLE_KEY?: string;
  WXT_CLERK_SYNC_HOST?: string;
  WXT_CLERK_FRONTEND_API?: string;
  WXT_ORDER_HISTORY_URL?: string;
}

export interface BrowserHandClerkConfig {
  /** Clerk publishable key (`pk_test_…` or `pk_live_…`). Safe to ship in the extension. */
  publishableKey?: string;
  /**
   * Optional website origin that shares this Clerk session with the extension.
   * Leave unset when the extension is the only signed-in surface.
   */
  syncHost?: string;
  /** Frontend API URL from the Clerk API keys page. Informational; the publishable key already encodes it. */
  frontendApi?: string;
  /** When set, order history is loaded from this HTTP endpoint instead of the local sample source. */
  orderHistoryUrl?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * A publishable key is configured when it looks like a real Clerk key.
 * The placeholder in `.env.example` is treated as unset so the account page
 * can explain setup instead of calling Clerk with a dummy key.
 */
export function isConfiguredPublishableKey(key: string | undefined): key is string {
  if (!key) return false;
  if (!key.startsWith("pk_test_") && !key.startsWith("pk_live_")) return false;
  if (key.includes("replace_me")) return false;
  return true;
}

export function readClerkConfig(env?: PublicClerkEnv): BrowserHandClerkConfig {
  // Property access is static on purpose: Vite inlines `import.meta.env.WXT_*`
  // only for direct reads, not for `import.meta.env[name]`.
  const source = env ?? {
    WXT_CLERK_PUBLISHABLE_KEY: import.meta.env.WXT_CLERK_PUBLISHABLE_KEY,
    WXT_CLERK_SYNC_HOST: import.meta.env.WXT_CLERK_SYNC_HOST,
    WXT_CLERK_FRONTEND_API: import.meta.env.WXT_CLERK_FRONTEND_API,
    WXT_ORDER_HISTORY_URL: import.meta.env.WXT_ORDER_HISTORY_URL,
  };

  return {
    publishableKey: clean(source.WXT_CLERK_PUBLISHABLE_KEY),
    syncHost: clean(source.WXT_CLERK_SYNC_HOST),
    frontendApi: clean(source.WXT_CLERK_FRONTEND_API),
    orderHistoryUrl: clean(source.WXT_ORDER_HISTORY_URL),
  };
}
