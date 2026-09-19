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

const worker =
  context.serviceWorkers().find((w) => w.url().includes("background")) ??
  context.serviceWorkers()[0];
const extensions = context
  .serviceWorkers()
  .map((w) => new URL(w.url()).host)
  .filter(Boolean);

// Point the extension at the replay server, through the popup, the way a user would.
if (command === "setup") {
  if (!worker) throw new Error("no extension service worker: is dist/chrome-mv3 loaded?");
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("summary").click();
  await popup.locator("#apiKey").fill("replay");
  await popup.locator("#baseUrl").fill("http://127.0.0.1:4333");
  await popup.locator("#baseUrl").blur();
  await popup.waitForTimeout(500);
  const stored = await worker.evaluate(() =>
    chrome.storage.local.get(["baseUrl", "apiKey"]).then((v) => ({
      baseUrl: v.baseUrl,
      keySet: Boolean(v.apiKey),
    })),
  );
  console.log(JSON.stringify({ extensionId: id, stored }, null, 2));
  await popup.close();
  await browser.close();
  process.exit(0);
}

const page = await context.newPage();
const captured = [];
page.on("console", (m) => {
  if (m.type() === "error") captured.push(m.text().slice(0, 120));
});
await page.goto(`https://www.youtube.com/watch?v=${videoId}${command === "run" ? "&jevdemo=1" : ""}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(command === "run" ? 20000 : 6000);

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

const trace = worker
  ? await worker
      .evaluate(() => chrome.storage.session.get("trace").then((v) => v.trace ?? null))
      .catch(() => null)
  : null;

console.log(
  JSON.stringify(
    {
      command,
      extensions,
      ...result,
      trace: trace && {
        status: trace.status,
        error: trace.error,
        model: trace.model,
        segmentCount: trace.segmentCount,
        chunks: `${trace.chunksDone}/${trace.chunksTotal}`,
        elapsedMs: trace.elapsedMs,
        slices: trace.slices?.length,
        nonContent: trace.slices?.filter((s) => s.category !== "content").length,
      },
      consoleErrors: captured.slice(0, 6),
    },
    null,
    2,
  ),
);
await browser.close();
