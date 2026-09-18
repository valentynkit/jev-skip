// Dev harness: loads the built extension in a real Chromium, opens a watch page, prints the
// trace the background worker produced plus every console error. Ground truth for the review
// and the rig the demo capture reuses.
//
//   node scripts/drive.mjs <videoId|url> [--key K] [--base-url U] [--seconds N] [--video DIR]
//
// ponytail: one file, no framework. It drives a browser and prints JSON; that is the whole job.
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const target = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const videoId = target?.includes("v=") ? new URL(target).searchParams.get("v") : target;
if (!videoId) {
  console.error("usage: node scripts/drive.mjs <videoId|watch url> [--key K] [--base-url U] [--seconds N] [--video DIR]");
  process.exit(2);
}

const key = flag("key", process.env.JEV_API_KEY ?? "shim");
const baseUrl = flag("base-url", process.env.JEV_BASE_URL ?? "http://127.0.0.1:4322");
const seconds = Number(flag("seconds", 45));
const videoDir = flag("video", null);
const extension = new URL("../dist/chrome-mv3", import.meta.url).pathname;

const profile = await mkdtemp(join(tmpdir(), "jev-skip-"));
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

// Logged-out YouTube shows the EU consent interstitial without this.
await context.addCookies([
  { name: "SOCS", value: "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNDA5LjA2X3AwGgJlbiACGgYIgLK_sAY", domain: ".youtube.com", path: "/" },
]);

const problems = [];
context.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
context.on("weberror", (e) => problems.push(`page error: ${e.error().message}`));
context.on("requestfailed", (r) => problems.push(`net: ${r.failure()?.errorText} ${r.url().slice(0, 90)}`));

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15000 }));
worker.on("console", (m) => {
  if (m.type() === "error") problems.push(`worker: ${m.text()}`);
});
const extensionId = new URL(worker.url()).host;

// Settings go in through the popup, the same path a user takes.
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.locator("summary").click();
await popup.locator("#apiKey").fill(key);
await popup.locator("#baseUrl").fill(baseUrl);
await popup.locator("#baseUrl").blur();
await popup.waitForTimeout(300);

const page = await context.newPage();
const started = Date.now();
await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });

let firstPaintMs = null;
const deadline = Date.now() + seconds * 1000;
while (Date.now() < deadline) {
  const painted = await page.locator(".jev-skip-bar li").count().catch(() => 0);
  if (painted && firstPaintMs === null) firstPaintMs = Date.now() - started;
  const status = await worker.evaluate(async () => {
    const { trace } = await chrome.storage.session.get("trace");
    return trace?.status ?? "none";
  }).catch(() => "worker gone");
  if (status === "done" || status === "error") break;
  await page.waitForTimeout(500);
}

const trace = await worker
  .evaluate(async () => (await chrome.storage.session.get("trace")).trace ?? null)
  .catch(() => null);
const painted = await page.locator(".jev-skip-bar li").count().catch(() => 0);
const barMounted = (await page.locator(".jev-skip-bar").count()) > 0;

console.log(
  JSON.stringify(
    {
      videoId,
      url: page.url(),
      pageTitle: await page.title().catch(() => null),
      hasVideoEl: (await page.locator("video").count()) > 0,
      hasProgressBar: (await page.locator(".ytp-progress-bar").count()) > 0,
      barMounted,
      paintedSlices: painted,
      firstPaintMs,
      trace: trace && {
        status: trace.status,
        error: trace.error,
        model: trace.model,
        segmentCount: trace.segmentCount,
        chunks: `${trace.chunksDone}/${trace.chunksTotal}`,
        estTokens: trace.estTokens,
        costUsd: trace.costUsd,
        elapsedMs: trace.elapsedMs,
        duration: trace.duration,
        slices: trace.slices?.length,
        top: trace.slices
          ?.filter((s) => s.category !== "content")
          .slice(0, 5)
          .map((s) => `${s.category} ${s.p.toFixed(2)} ${Math.round(s.start)}-${Math.round(s.end)}s`),
      },
      problems: problems.slice(0, 20),
    },
    null,
    2,
  ),
);

await context.close();
await rm(profile, { recursive: true, force: true });
