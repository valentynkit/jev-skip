// What does the player itself ask for when you turn captions on? Turns subtitles on in a
// real browser over CDP and records every timedtext request, then diffs the player's URL
// against the baseUrl we read out of the player response.
//
//   node scripts/timedtext.mjs <videoId>
import { chromium } from "playwright";

const videoId = process.argv[2] ?? "4RcThoRG46c";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const page = await context.newPage();

const seen = [];
page.on("request", (r) => {
  if (r.url().includes("/api/timedtext")) seen.push({ url: r.url(), method: r.method() });
});
page.on("response", async (r) => {
  if (!r.url().includes("/api/timedtext")) return;
  const entry = seen.find((s) => s.url === r.url()) ?? { url: r.url() };
  entry.status = r.status();
  entry.bytes = await r
    .body()
    .then((b) => b.length)
    .catch(() => null);
});

await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

// Turn captions on the way a viewer does.
await page.evaluate(() => {
  const player = document.querySelector("#movie_player");
  try {
    const tracks = player?.getOption?.("captions", "tracklist") ?? [];
    if (tracks.length) player.setOption("captions", "track", tracks[0]);
  } catch {}
});
await page.keyboard.press("c").catch(() => {});
await page.waitForTimeout(6000);

const ours = await page.evaluate(() => {
  const tracks =
    window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find((t) => (t.languageCode || "").startsWith("en")) ?? tracks[0];
  return track?.baseUrl ?? null;
});

const params = (url) => {
  try {
    return [...new URL(url).searchParams.keys()].sort();
  } catch {
    return [];
  }
};

const playerUrl = seen.find((s) => s.bytes)?.url ?? seen[0]?.url ?? null;
const oursParams = params(ours);
const playerParams = params(playerUrl ?? "");

console.log(
  JSON.stringify(
    {
      requestsSeen: seen.length,
      requests: seen.map((s) => ({ status: s.status, bytes: s.bytes, url: s.url.slice(0, 160) })),
      ourParams: oursParams,
      playerParams,
      playerOnly: playerParams.filter((p) => !oursParams.includes(p)),
      weHaveOnly: oursParams.filter((p) => !playerParams.includes(p)),
      captionsRendered: await page.locator(".ytp-caption-segment").count().catch(() => 0),
    },
    null,
    2,
  ),
);
await browser.close();
