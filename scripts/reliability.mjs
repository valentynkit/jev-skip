// How often does the bar actually paint? Cold loads against a browser that already has the
// extension, counting what happened and why it did not.
//
//   node scripts/reliability.mjs [--loads 15] [--port 9223]
//
// Needs scripts/answer-server.mjs running, so a miss means the extension failed to read
// captions rather than the endpoint failing to answer.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const loads = Number(flag("loads", 15));
const port = flag("port", "9223");

const videos = JSON.parse(readFileSync("fixtures/videos.json", "utf8"))
  .filter((v) => !v.synthetic)
  .slice(0, 5);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const results = [];

for (let i = 0; i < loads; i++) {
  const video = videos[i % videos.length];
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const started = Date.now();
  let painted = 0;
  let firstPaintMs = null;
  try {
    await page.goto(`https://www.youtube.com/watch?v=${video.videoId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    for (let t = 0; t < 40; t++) {
      painted = await page.locator(".jev-skip-bar li").count().catch(() => 0);
      if (painted) {
        firstPaintMs = Date.now() - started;
        break;
      }
      await page.waitForTimeout(500);
    }
  } catch {}
  const why = painted
    ? null
    : await page
        .evaluate(() => ({
          botWall: document.body.innerText.includes("Sign in to confirm you're not a bot"),
          hasPlayer: Boolean(document.querySelector("#movie_player")),
          hookInstalled: Boolean(document.querySelector("video")),
        }))
        .catch(() => null);
  results.push({ videoId: video.videoId, painted, firstPaintMs, why });
  console.error(
    `${i + 1}/${loads} ${video.videoId} ${painted ? `painted ${painted} in ${firstPaintMs}ms` : `MISS ${JSON.stringify(why)}`}`,
  );
  await page.close().catch(() => {});
}

const hits = results.filter((r) => r.painted).length;
const times = results.filter((r) => r.firstPaintMs).map((r) => r.firstPaintMs).sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      loads,
      painted: hits,
      rate: `${((hits / loads) * 100).toFixed(0)}%`,
      firstPaintMsMedian: times.length ? times[Math.floor(times.length / 2)] : null,
      misses: results.filter((r) => !r.painted),
    },
    null,
    2,
  ),
);
process.exit(0);
