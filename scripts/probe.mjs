// Why did the content script give up? Runs the caption steps in the page, per video, per format.
//   node scripts/probe.mjs <videoId> [videoId...]
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("usage: node scripts/probe.mjs <videoId> [videoId...]");

const profile = await mkdtemp(join(tmpdir(), "jev-probe-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
await context.addCookies([
  { name: "SOCS", value: "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNDA5LjA2X3AwGgJlbiACGgYIgLK_sAY", domain: ".youtube.com", path: "/" },
]);
const page = await context.newPage();

for (const id of ids) {
  await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const result = await page.evaluate(async () => {
    const tracks =
      window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const out = {
      trackCount: tracks.length,
      langs: tracks.map((t) => `${t.languageCode}${t.kind === "asr" ? ":asr" : ""}`),
      playability: window.ytInitialPlayerResponse?.playabilityStatus?.status,
      formats: {},
    };
    const track = tracks.find((t) => (t.languageCode || "").startsWith("en")) ?? tracks[0];
    if (!track) return out;
    out.hasPot = track.baseUrl.includes("pot=");
    for (const fmt of ["json3", "srv3", "vtt", ""]) {
      const url = fmt ? `${track.baseUrl}&fmt=${fmt}` : track.baseUrl;
      try {
        const res = await fetch(url);
        const body = await res.text();
        out.formats[fmt || "default"] = { status: res.status, length: body.length, head: body.slice(0, 80) };
      } catch (e) {
        out.formats[fmt || "default"] = { error: String(e).slice(0, 80) };
      }
    }
    return out;
  });
  console.log(id, JSON.stringify(result, null, 1));
}

await context.close();
await rm(profile, { recursive: true, force: true });
