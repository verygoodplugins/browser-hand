import { defineConfig } from "wxt";

export default defineConfig({
  vite: () => {
    const port = process.env.BROWSER_HAND_EXTENSION_RELAY_PORT || "9333";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error("BROWSER_HAND_EXTENSION_RELAY_PORT must be a port from 1 to 65535");
    }
    return { define: { __BROWSER_HAND_RELAY_PORT__: JSON.stringify(port) } };
  },
  // Stable non-hidden path for Chrome → Load unpacked
  outDir: "dist",
  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.browser === "safari" && manifest.manifest_version === 3) {
        // Safari's MV3 event page can initiate the local relay connection when
        // installed; its service worker did not start in the live trial.
        // Chrome's MV3 TypeScript type omits Safari's supported event-page form.
        manifest.background = { scripts: ["background.js"], persistent: false } as unknown as typeof manifest.background;
      }
    },
  },
  manifest: ({ browser }) => ({
    name: "Browser Hand",
    description: "Give agents a hand on your real browser — local extension bridge for Browser Hand",
    // userScripts lets debugger-free mode run on pages whose CSP forbids eval; it
    // only takes effect once the user turns on "Allow User Scripts" (Chrome) or
    // the browser grants it (Search).
    permissions: browser === "safari"
      ? ["scripting", "tabs", "storage", "alarms"]
      : ["debugger", "scripting", "tabGroups", "tabs", "storage", "alarms", "userScripts"],
    host_permissions: ["<all_urls>"],
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
  }),
});
