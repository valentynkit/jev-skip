// Can we get a usable caption URL without being the player? Hooks fetch/XHR in the page
// world, turns captions on, captures whatever timedtext URL the player signs, and re-reads
// it as json3. If this works, the content script can do the same thing.
//
//   node scripts/pot-probe.mjs <videoId>
import { chromium } from "playwright";

const videoId = process.argv[2] ?? "4RcThoRG46c";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const page = await context.newPage();

// The page world, which is where BotGuard and the player live.
await page.addInitScript(() => {
  window.__jevCaptionUrls = [];
  const record = (url) => {
    if (typeof url === "string" && url.includes("/api/timedtext")) window.__jevCaptionUrls.push(url);
  };
  const fetchImpl = window.fetch;
  window.fetch = function (input, init) {
    record(typeof input === "string" ? input : input?.url);
    return fetchImpl.apply(this, arguments);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    record(url);
    return open.apply(this, arguments);
  };
});

await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// Ask the player for captions the way the 'c' key does, then put it back.
const toggled = await page.evaluate(() => {
  const player = document.querySelector("#movie_player");
  if (!player?.getOption) return "no player api";
  try {
    const tracks = player.getOption("captions", "tracklist") ?? [];
    if (!tracks.length) return "no tracks";
    player.setOption("captions", "track", tracks[0]);
    return `enabled ${tracks[0].languageCode ?? "?"}`;
  } catch (e) {
    return `threw: ${e.message}`;
  }
});
await page.waitForTimeout(5000);

const result = await page.evaluate(async () => {
  const urls = window.__jevCaptionUrls ?? [];
  const withPot = urls.filter((u) => u.includes("pot="));
  const out = { captured: urls.length, withPot: withPot.length };
  const pick = withPot[withPot.length - 1] ?? urls[urls.length - 1];
  if (!pick) return out;

  const json3 = pick.includes("fmt=") ? pick.replace(/fmt=[^&]*/, "fmt=json3") : `${pick}&fmt=json3`;
  const res = await fetch(json3);
  const body = await res.text();
  out.status = res.status;
  out.bytes = body.length;
  try {
    const parsed = JSON.parse(body);
    const events = (parsed.events ?? []).filter((e) => e.segs);
    out.cues = events.length;
    out.firstCue = events[0]?.segs?.map((s) => s.utf8).join("") ?? null;
    out.lastCueStartSec = events.length ? Math.round(events[events.length - 1].tStartMs / 1000) : null;
  } catch {
    out.parse = "not json";
  }
  return out;
});

// Put captions back the way they were.
await page.evaluate(() => {
  try {
    document.querySelector("#movie_player")?.setOption("captions", "track", {});
  } catch {}
});

console.log(JSON.stringify({ toggled, ...result }, null, 2));
await browser.close();
