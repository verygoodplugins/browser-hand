import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "wxt";
import { loadBrowserHandEnv } from "./scripts/load-env.mjs";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(extensionDir, "..");
loadBrowserHandEnv(repoRoot);

const PUBLIC_ENV_KEYS = [
  "WXT_CLERK_PUBLISHABLE_KEY",
  "WXT_CLERK_SYNC_HOST",
  "WXT_CLERK_FRONTEND_API",
  "WXT_ORDER_HISTORY_URL",
] as const;

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function hostPermission(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withProtocol = value.includes("://") ? value : `https://${value}`;
  return `${withProtocol.replace(/\/$/, "")}/*`;
}

function clientEnvDefines(): Record<string, string> {
  const define: Record<string, string> = {};
  for (const key of PUBLIC_ENV_KEYS) {
    const value = optionalEnv(key);
    if (value) define[`import.meta.env.${key}`] = JSON.stringify(value);
  }
  return define;
}

const extensionPublicKey = optionalEnv("WXT_EXTENSION_PUBLIC_KEY")?.replace(/\s+/g, "");
const clerkFrontendHost = hostPermission(optionalEnv("WXT_CLERK_FRONTEND_API"));
const clerkSyncHost = hostPermission(optionalEnv("WXT_CLERK_SYNC_HOST"));

export default defineConfig({
  // Stable non-hidden path for Chrome → Load unpacked
  outDir: "dist",
  vite: () => ({
    // Repo-root .env is the documented file. Public WXT_* values are also
    // copied into import.meta.env below so extension/.env still works.
    envDir: repoRoot,
    define: clientEnvDefines(),
    plugins: [react()],
  }),
  manifest: {
    name: "Browser Hand",
    description: "Give agents a hand on your real Chrome — local extension bridge for Browser Hand",
    // userScripts lets debugger-free mode run on pages whose CSP forbids eval; it
    // only takes effect once the user turns on "Allow User Scripts" (Chrome) or
    // the browser grants it (Search).
    // storage holds the extension's own Clerk session. cookies is added only when
    // WXT_CLERK_SYNC_HOST is set, which is the mode that shares a website session.
    permissions: [
      "debugger",
      "scripting",
      "tabGroups",
      "tabs",
      "storage",
      "alarms",
      "userScripts",
      ...(clerkSyncHost ? (["cookies"] as const) : []),
    ],
    host_permissions: [
      "<all_urls>",
      ...(clerkFrontendHost ? [clerkFrontendHost] : []),
      ...(clerkSyncHost ? [clerkSyncHost] : []),
    ],
    // Optional. Pins the unpacked extension id so Clerk allowed origins stay stable.
    // Public key only — never commit the Chrome Web Store private key.
    ...(extensionPublicKey ? { key: extensionPublicKey } : {}),
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
  },
});
