import { defineConfig } from "wxt";

export default defineConfig({
  // Stable non-hidden path for Chrome → Load unpacked
  outDir: "dist",
  manifest: {
    name: "Browser Hand",
    description:
      "Give agents a hand on your real Chrome — local extension bridge for Browser Hand",
    permissions: ["debugger", "scripting", "tabGroups", "tabs", "storage", "alarms"],
    host_permissions: ["<all_urls>"],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
});
