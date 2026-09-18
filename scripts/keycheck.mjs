// Can a content script read the API key out of storage.local? The review says
// storage.local.setAccessLevel is a no-op because access levels only exist on
// storage.session. This asks the browser rather than the docs.
//
//   node scripts/keycheck.mjs
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extension = new URL("../dist/chrome-mv3", import.meta.url).pathname;
const profile = await mkdtemp(join(tmpdir(), "jev-keycheck-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--mute-audio"],
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15000 }));
const extensionId = new URL(worker.url()).host;

const fromWorker = await worker.evaluate(async () => {
  await chrome.storage.local.set({ apiKey: "SECRET-canary-123" });
  return {
    localHasSetAccessLevel: typeof chrome.storage.local.setAccessLevel,
    sessionHasSetAccessLevel: typeof chrome.storage.session.setAccessLevel,
    setAccessLevelResult: await chrome.storage.local
      .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
      .then(() => "resolved")
      .catch((e) => `threw: ${e.message}`),
  };
});

// A content script runs in the isolated world of the page, which is what a hostile page
// would have to subvert. This reads storage from exactly that context.
const page = await context.newPage();
await page.goto("https://www.youtube.com/robots.txt", { waitUntil: "domcontentloaded" });
const fromContentScript = await page.evaluate(async () => {
  // The page world has no chrome.storage; the content script's isolated world does.
  return typeof chrome !== "undefined" && chrome.storage ? "page world sees chrome.storage" : "page world blind";
});
await page.waitForTimeout(2500);
// The temporary probe in the content script writes what it could read to the <html> tag.
const contentScriptRead = await page.evaluate(
  () => document.documentElement.dataset.jevKeyProbe ?? "(probe absent)",
);

console.log(JSON.stringify({ fromWorker, fromContentScript, contentScriptRead }, null, 2));
await context.close();
await rm(profile, { recursive: true, force: true });
