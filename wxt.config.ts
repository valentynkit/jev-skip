import { defineConfig } from "wxt";

/**
 * The popup lets you point the endpoint somewhere else, but a published build must not be
 * able to reach a local server: host permissions are the only thing standing between a
 * typo'd endpoint and your key. Shim and replay work needs it, so it is a build flag.
 *   JEV_ALLOW_LOCALHOST=1 npm run build
 */
const localhost = process.env.JEV_ALLOW_LOCALHOST
  ? ["http://127.0.0.1/*", "http://localhost/*"]
  : [];

export default defineConfig({
  outDir: "dist",
  manifest: {
    name: "jev-skip",
    description: "Skips YouTube sponsors on videos nobody has labeled yet.",
    permissions: ["storage"],
    host_permissions: ["https://*.youtube.com/*", "https://api.typesafe.ai/*", ...localhost],
    browser_specific_settings: {
      gecko: { id: "jev-skip@jev-lab", strict_min_version: "121.0" },
    },
  },
});
