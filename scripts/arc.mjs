// Drives an already-running Chromium-based browser over CDP, so the session is a real
// signed-in one and no automated login is ever attempted.
//
//   /Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222 --load-extension=dist/chrome-mv3
//   node scripts/arc.mjs check <videoId>     captions, playback, whether the extension is loaded
//
// Nothing here reads credentials or touches profile files. It opens a tab and reads the
// page, the same as sitting in front of the browser.
import { chromium } from "playwright";

const [command = "check", videoId = "4RcThoRG46c"] = process.argv.slice(2);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];

const extensions = context
  .serviceWorkers()
  .map((w) => new URL(w.url()).host)
  .filter(Boolean);

const page = await context.newPage();
await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const result = await page.evaluate(async () => {
  const tracks =
    window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find((t) => (t.languageCode || "").startsWith("en")) ?? tracks[0];
  const video = document.querySelector("video");
  const out = {
    signedIn: !!document.querySelector("#avatar-btn"),
    botWall: document.body.innerText.includes("Sign in to confirm you're not a bot"),
    playback: video ? { readyState: video.readyState, duration: video.duration } : null,
    trackCount: tracks.length,
    langs: tracks.map((t) => `${t.languageCode}${t.kind === "asr" ? ":asr" : ""}`),
    barMounted: !!document.querySelector(".jev-skip-bar"),
    paintedSlices: document.querySelectorAll(".jev-skip-bar li").length,
  };
  if (track) {
    out.hasPot = track.baseUrl.includes("pot=");
    const res = await fetch(`${track.baseUrl}&fmt=json3`);
    const body = await res.text();
    out.captionStatus = res.status;
    out.captionBytes = body.length;
    out.captionHead = body.slice(0, 120);
  }
  return out;
});

console.log(JSON.stringify({ command, extensions, ...result }, null, 2));
await browser.close();
