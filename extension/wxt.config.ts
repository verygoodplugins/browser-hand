import { defineConfig } from "wxt";

export default defineConfig({
  // Stable non-hidden path for Chrome → Load unpacked
  outDir: "dist",
  manifest: {
    name: "Browser Hand",
    description: "Give agents a hand on your real Chrome — local extension bridge for Browser Hand",
    // userScripts lets debugger-free mode run on pages whose CSP forbids eval; it
    // only takes effect once the user turns on "Allow User Scripts" (Chrome) or
    // the browser grants it (Search).
    permissions: ["debugger", "scripting", "tabGroups", "tabs", "storage", "alarms", "userScripts"],
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
  },
});
