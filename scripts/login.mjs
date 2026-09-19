// Opens the recording profile and waits while you sign into YouTube by hand, then checks
// whether a signed-in session actually gets caption bytes. Run once; the profile persists.
//
//   node scripts/login.mjs [--profile DIR]
//
// Nothing is typed for you and no credentials are read. The window closes when the check
// is done, and the cookies stay in the profile directory for the recording runs.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const profile = flag("profile", "/tmp/jev-profile");
const waitMinutes = Number(flag("minutes", 10));

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1280, height: 860 },
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });

console.error(`Sign in to YouTube in the window that just opened. Profile: ${profile}`);
console.error(`Waiting up to ${waitMinutes} minutes, checking every 5 seconds.`);

const deadline = Date.now() + waitMinutes * 60_000;
let signedIn = false;
while (Date.now() < deadline) {
  signedIn = await page
    .locator("#avatar-btn, ytd-topbar-menu-button-renderer img")
    .first()
    .isVisible()
    .catch(() => false);
  if (signedIn) break;
  await page.waitForTimeout(5000);
}

if (!signedIn) {
  console.error("No signed-in avatar appeared. Leaving the profile as it is.");
  await context.close();
  process.exit(1);
}

console.error("Signed in. Checking whether captions come back with bytes.");
await page.goto("https://www.youtube.com/watch?v=4RcThoRG46c", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

const result = await page.evaluate(async () => {
  const tracks =
    window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find((t) => (t.languageCode || "").startsWith("en")) ?? tracks[0];
  const video = document.querySelector("video");
  const out = {
    botWall: document.body.innerText.includes("Sign in to confirm you're not a bot"),
    playback: video ? { readyState: video.readyState, duration: video.duration } : null,
    trackCount: tracks.length,
    hasPot: track ? track.baseUrl.includes("pot=") : null,
  };
  if (track) {
    const res = await fetch(`${track.baseUrl}&fmt=json3`);
    const body = await res.text();
    out.captionStatus = res.status;
    out.captionBytes = body.length;
    out.captionHead = body.slice(0, 100);
  }
  return out;
});

console.log(JSON.stringify(result, null, 2));
console.error(
  result.captionBytes > 0
    ? "Captions work in this session. The recording runs can use this profile."
    : "Captions still empty. A signed-in session is not enough; see docs/browser-ground-truth.md.",
);
await context.close();
