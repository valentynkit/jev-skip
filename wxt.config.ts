import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "dist",
  manifest: {
    name: "jev-skip",
    description: "Skips YouTube sponsors on videos nobody has labeled yet.",
    permissions: ["storage"],
    host_permissions: ["https://*.youtube.com/*", "https://api.typesafe.ai/*"],
    browser_specific_settings: {
      gecko: { id: "jev-skip@jev-lab", strict_min_version: "121.0" },
    },
  },
});
