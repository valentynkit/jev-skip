// Records the demo take from a browser that already has the extension loaded, over CDP.
// Frames come from the page itself, so the capture is the watch page and nothing else on
// the desktop.
//
//   node scripts/record-demo.mjs <videoId> [--port 9223] [--out demo/raw]
//
// What it films is a real run: the extension reads the captions, asks the endpoint, and
// paints what comes back. With scripts/answer-server.mjs behind it those answers are the
// ones recorded on 2026-09-18, replayed at their recorded latency.
import { chromium } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const videoId = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--port" && argv[argv.indexOf(a) - 1] !== "--out") ?? "4RcThoRG46c";
const port = flag("port", "9223");
const out = flag("out", "demo/raw");

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.goto("about:blank");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  frames.push({ data, timestamp: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

// YouTube fades its controls out after a couple of seconds and the bar lives inside them,
// so the take keeps the pointer alive over the player the whole way through.
let jiggling = true;
const jiggle = (async () => {
  let n = 0;
  while (jiggling) {
    await page.mouse.move(600 + (n % 3) * 12, 300 + (n % 2) * 10).catch(() => {});
    n += 1;
    await new Promise((r) => setTimeout(r, 700));
  }
})();

// Filming starts before the page does, so the bar filling happens on camera.
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
await page.goto(`https://www.youtube.com/watch?v=${videoId}&jevdemo=1`, { waitUntil: "domcontentloaded" });

// The skip fires on its own a few seconds in; nothing here seeks or stages it.
const seen = { painted: 0, toast: null, skippedAt: null };
for (let i = 0; i < 24; i++) {
  const s = await page.evaluate(() => ({
    painted: document.querySelectorAll(".jev-skip-bar li").length,
    toast: document.querySelector(".jev-skip-toast")?.textContent ?? null,
    t: Math.round(document.querySelector("video")?.currentTime ?? 0),
  }));
  seen.painted = Math.max(seen.painted, s.painted);
  if (s.toast && !seen.toast) {
    seen.toast = s.toast;
    seen.skippedAt = s.t;
  }
  if (seen.toast && i > 8) break;
  await page.waitForTimeout(500);
}

// Then rest on a faint slice: the tooltip is the argument for trusting the colour.
const faint = page.locator('.jev-skip-bar li').filter({ hasNotText: "" });
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll(".jev-skip-bar li")]
    .map((li) => ({ p: Number(li.dataset.p), rect: li.getBoundingClientRect() }))
    .filter((x) => x.p < 0.85)
    .sort((a, b) => a.p - b.p)
    .map((x) => ({ p: x.p, x: x.rect.left + x.rect.width / 2, y: x.rect.top + x.rect.height / 2 })),
);
let tooltip = null;
if (boxes.length) {
  jiggling = false;
  await jiggle;
  await page.mouse.move(boxes[0].x, boxes[0].y, { steps: 25 });
  await page.waitForTimeout(2500);
  tooltip = await page.locator(".jev-skip-tip").textContent().catch(() => null);
} else {
  jiggling = false;
  await jiggle;
}

await cdp.send("Page.stopScreencast").catch(() => {});

let index = 0;
const firstTs = frames[0]?.timestamp ?? 0;
for (const frame of frames) {
  await writeFile(`${out}/frame-${String(index).padStart(5, "0")}.jpg`, Buffer.from(frame.data, "base64"));
  index += 1;
}
const seconds = (frames[frames.length - 1]?.timestamp ?? firstTs) - firstTs;
const fps = seconds > 0 ? frames.length / seconds : 15;

console.log(
  JSON.stringify(
    {
      videoId,
      paintedSlices: seen.painted,
      toast: seen.toast,
      skippedAt: seen.skippedAt,
      tooltip,
      faintSlices: boxes.length,
      frames: frames.length,
      seconds: Number(seconds.toFixed(1)),
      fps: Number(fps.toFixed(2)),
      out,
    },
    null,
    2,
  ),
);

await page.close().catch(() => {});
process.exit(0);
