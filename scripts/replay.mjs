// Paints a recorded trace onto a real watch page, then drives a skip. No key, no live
// captions: the answers come from fixtures/answers (real Jev, recorded 2026-09-18 through
// the gateway shim) and the captions from fixtures/videos/<id>/captions.json3.
//
//   node scripts/replay.mjs <videoId> [--seconds N] [--video DIR] [--shot FILE]
//
// Anything recorded with this is a replay, not a live call. Label it that way.
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson3, dedupeRollingCues } from "../lib/captions.ts";
import { segmentCues } from "../lib/segment.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const videoId = args[0];
if (!videoId || videoId.startsWith("--")) {
  console.error("usage: node scripts/replay.mjs <videoId> [--seconds N] [--video DIR] [--shot FILE]");
  process.exit(2);
}
const seconds = Number(flag("seconds", 30));
const videoDir = flag("video", null);
const shot = flag("shot", null);

/** Rebuild the trace the background worker would have published for this video. */
function buildTrace(id) {
  const videos = JSON.parse(readFileSync("fixtures/videos.json", "utf8"));
  const video = videos.find((v) => v.videoId === id);
  if (!video) throw new Error(`${id} is not in fixtures/videos.json`);
  const cues = dedupeRollingCues(parseJson3(readFileSync(`fixtures/videos/${id}/captions.json3`, "utf8")) ?? []);
  const segments = segmentCues(cues);
  const byId = new Map(segments.map((s) => [s.id, s]));

  const answers = {};
  let usage = 0;
  let elapsedMs = 0;
  let model = "";
  for (const file of readdirSync("fixtures/answers")) {
    const payload = JSON.parse(readFileSync(join("fixtures/answers", file), "utf8"));
    if (payload.videoId !== id) continue;
    Object.assign(answers, payload.answers);
    usage += payload.usage?.input_tokens ?? 0;
    elapsedMs = Math.max(elapsedMs, payload.elapsedMs ?? 0);
    model = payload.model ?? model;
  }
  if (!Object.keys(answers).length) throw new Error(`no recorded answers for ${id}`);

  const slices = Object.entries(answers)
    .map(([sid, answer]) => {
      const segment = byId.get(sid);
      if (!segment || answer?.type !== "choice") return null;
      return {
        id: sid,
        start: segment.start,
        end: segment.end,
        category: answer.choice,
        p: answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0,
        text: segment.text,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  return {
    videoId: id,
    title: video.title,
    channel: video.channel,
    status: "done",
    model,
    segmentCount: segments.length,
    estTokens: usage,
    costUsd: (usage * 0.042) / 1_000_000,
    chunksTotal: 1,
    chunksDone: 1,
    startedAt: Date.now(),
    elapsedMs,
    duration: video.duration,
    slices,
  };
}

const trace = buildTrace(videoId);
const firstSkippable = trace.slices.find((s) => s.p >= 0.85 && s.category !== "content" && s.category !== "other");
console.error(
  `replaying ${trace.slices.length} slices, ${trace.slices.filter((s) => s.category !== "content").length} non-content, first skippable at ${firstSkippable ? Math.round(firstSkippable.start) : "none"}s`,
);

const extension = new URL("../dist/chrome-mv3", import.meta.url).pathname;
// A warm profile keeps YouTube from treating every run as a brand new suspicious client.
const profile = flag("profile", null) ?? (await mkdtemp(join(tmpdir(), "jev-replay-")));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  recordVideo: videoDir ? { dir: videoDir, size: { width: 1280, height: 800 } } : undefined,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
  ],
});
await context.addCookies([
  { name: "SOCS", value: "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNDA5LjA2X3AwGgJlbiACGgYIgLK_sAY", domain: ".youtube.com", path: "/" },
]);

const problems = [];
context.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`.slice(0, 160)));
context.on("weberror", (e) => problems.push(`page error: ${e.error().message}`.slice(0, 160)));

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15000 }));
const page = await context.newPage();
await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ytp-progress-bar", { state: "attached", timeout: 30000 });
// Controls fade out on their own; a mouse nudge over the player brings the seek bar back.
await page.mouse.move(640, 300);
await page.waitForTimeout(2000);

const step = (name) => console.error(`  … ${name} @${Math.round(process.uptime())}s`);
step("page ready");
// The content script mounts the bar when a trace arrives, exactly as the worker would send it.
await worker.evaluate(async ({ trace }) => {
  const tabs = await chrome.tabs.query({ url: "https://*.youtube.com/*" });
  for (const tab of tabs) {
    await chrome.tabs.sendMessage(tab.id, {
      type: "trace",
      trace,
      settings: { threshold: 0.85, autoSkip: true },
    });
  }
}, { trace });
await page.waitForTimeout(800);

step("trace sent");
const painted = await page.locator(".jev-skip-bar li").count();
const report = { videoId, paintedSlices: painted, slicesSent: trace.slices.length };
report.playback = await page.evaluate(() => {
  const v = document.querySelector("video");
  return v && { readyState: v.readyState, duration: v.duration, src: (v.src || "").slice(0, 40), error: v.error?.message ?? null };
});
await page.evaluate(() => window.scrollTo(0, 0));
// Controls hide themselves; the progress bar only exists to hover while they are up.
await page.mouse.move(640, 300);

// Hover the first painted slice: the "why" tooltip is half the pitch.
if (painted) {
  const slice = page.locator(".jev-skip-bar li").first();
  const box = await slice.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  report.hover = box ? `moved to ${Math.round(box.x)},${Math.round(box.y)}` : "no box";
  await page.waitForTimeout(500);
  report.tooltip = await page.locator(".jev-skip-tip").textContent().catch(() => null);
  report.tooltipVisible = await page.locator(".jev-skip-tip").isVisible().catch(() => false);
  report.progressBarChildren = await page.evaluate(() => {
    const bar = document.querySelector(".ytp-progress-bar");
    const container = document.querySelector(".ytp-progress-bar-container");
    const describe = (el) => `${el.className.split(" ")[0]} z=${getComputedStyle(el).zIndex} pe=${getComputedStyle(el).pointerEvents}`;
    return {
      insideBar: [...(bar?.children ?? [])].map(describe),
      insideContainer: [...(container?.children ?? [])].map(describe),
    };
  });
  report.topElementAtSlice = await slice.evaluate((li) => {
    const r = li.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top ? `${top.tagName.toLowerCase()}.${top.className}`.slice(0, 80) : null;
  });
  await page.mouse.move(640, 400);
}

// Park the playhead just before the first confident slice and let the timer fire.
step("hover done");
if (firstSkippable) {
  // Nothing awaited inside the page: video.play() can stay pending forever mid-seek.
  await page.evaluate((target) => {
    const player = document.querySelector("#movie_player");
    const video = document.querySelector("video");
    const to = Math.max(0, target - 3);
    if (player?.seekTo) player.seekTo(to, true);
    else video.currentTime = to;
    player?.playVideo?.();
    void video?.play()?.catch(() => {});
  }, firstSkippable.start);
  await page.waitForTimeout(2000);
  const landedAt = await page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
  report.seekedTo = Math.round(landedAt);
  step(`seeked to ${Math.round(landedAt)}`);
  await page.waitForTimeout(6000);
  report.toast = await page.locator(".jev-skip-toast").textContent().catch(() => null);
  report.playheadAfter = await page.evaluate(() => document.querySelector("video")?.currentTime ?? null);
  report.expectedSkipTo = Math.round(firstSkippable.end);
  report.videoPlaying = await page.evaluate(() => {
    const v = document.querySelector("video");
    return v ? !v.paused && v.readyState > 2 : false;
  });
}

step("skip window over");
if (shot) await page.screenshot({ path: shot });
await page.waitForTimeout(seconds * 1000 > 8000 ? seconds * 1000 - 8000 : 0);

report.problems = problems.slice(0, 10);
console.log(JSON.stringify(report, null, 2));

await context.close();
if (!flag("profile", null)) await rm(profile, { recursive: true, force: true });
