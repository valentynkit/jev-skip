/**
 * The Chrome path: a MAIN-world content script at document_start, which the browser runs
 * before the page's own scripts. Injecting a <script src> instead was a race the player
 * won about a third of the time, and a lost race looks exactly like a video with no
 * captions.
 */
import { installPageHook } from "../lib/page-hook.ts";

export default defineContentScript({
  matches: ["https://*.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    // Firefox MV2 ignores the world key and runs this in the isolated world, where hooking
    // fetch achieves nothing. The extension APIs are the tell: the page world has no
    // runtime id. There, injected.js does the job instead.
    const api = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome;
    const isolated = Boolean(api?.runtime?.id);
    if (isolated) return;
    installPageHook();
  },
});
