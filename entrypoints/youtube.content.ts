import { readCaptions } from "../lib/captions.ts";
import { segmentCues } from "../lib/segment.ts";
import { mountBar, type BarHandle } from "../lib/bar.ts";
import { LEAD_MS, createScheduler, type Scheduler } from "../lib/schedule.ts";
import type { Slice, Trace, VideoInfo } from "../lib/types.ts";

export default defineContentScript({
  matches: ["https://*.youtube.com/*"],
  runAt: "document_idle",
  main() {
    let bar: BarHandle | null = null;
    let scheduler: Scheduler | null = null;
    let currentId = "";
    let lastSkip: { at: number; slice: Slice } | null = null;

    const firefox = navigator.userAgent.includes("Firefox");

    function teardown() {
      bar?.destroy();
      bar = null;
      scheduler?.destroy();
      scheduler = null;
      document.querySelector(".jev-skip-toast")?.remove();
    }

    function toast(slice: Slice) {
      document.querySelector(".jev-skip-toast")?.remove();
      const node = document.createElement("div");
      node.className = "jev-skip-toast";
      node.style.cssText =
        "position:fixed;left:50%;bottom:11%;transform:translateX(-50%);z-index:2147483647;" +
        "display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;" +
        "background:#11131aee;color:#e6e9f0;font:13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;" +
        "font-variant-numeric:tabular-nums;box-shadow:0 8px 28px rgba(0,0,0,.45);transition:opacity .4s;";
      const seconds = Math.round(slice.end - slice.start);
      const label = document.createElement("span");
      label.textContent = `skipped ${seconds}s of ${slice.category} (${slice.p.toFixed(2)})`;
      const undo = document.createElement("button");
      undo.textContent = "undo";
      undo.style.cssText =
        "background:none;border:0;color:#4cc9f0;font:inherit;cursor:pointer;padding:0;text-decoration:underline;";
      undo.addEventListener("click", () => {
        const video = document.querySelector("video");
        if (video) video.currentTime = slice.start;
        node.remove();
      });
      node.append(label, document.createTextNode("·"), undo);
      document.body.append(node);
      setTimeout(() => {
        node.style.opacity = "0";
        setTimeout(() => node.remove(), 400);
      }, 4000);
      lastSkip = { at: Date.now(), slice };
    }

    function attach(video: HTMLVideoElement) {
      const progress = document.querySelector<HTMLElement>(".ytp-progress-bar");
      if (!progress || bar) return;
      bar = mountBar(progress);
      scheduler = createScheduler(video, {
        threshold: 0.85,
        autoSkip: true,
        leadMs: firefox ? LEAD_MS.firefox : LEAD_MS.chrome,
        onSkip: toast,
      });
    }

    /**
     * ponytail: the watch page is fetched again and scraped for ytInitialPlayerResponse
     * rather than reaching into the page world. One code path that also works after an SPA
     * navigation; the ceiling is a YouTube markup change, which shows up as no bar at all.
     */
    async function playerResponse(videoId: string) {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        credentials: "include",
      });
      const html = await res.text();
      const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s);
      if (!match) return null;
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }

    async function start() {
      const videoId = new URL(location.href).searchParams.get("v");
      if (!location.pathname.startsWith("/watch") || !videoId) {
        teardown();
        currentId = "";
        return;
      }
      if (videoId === currentId) return;
      teardown();
      currentId = videoId;

      const player = await playerResponse(videoId);
      const cues = await readCaptions(player);
      // No captions means no opinion: no bar, no request.
      if (!cues?.length) return;

      const video = document.querySelector("video");
      if (video) attach(video);

      const details = player?.videoDetails ?? {};
      const info: VideoInfo = {
        videoId,
        title: details.title ?? document.title,
        channel: details.author ?? "",
        duration: Number(details.lengthSeconds ?? video?.duration ?? 0),
      };
      browser.runtime.sendMessage({ type: "judge", video: info, segments: segmentCues(cues) });
    }

    browser.runtime.onMessage.addListener(
      (message: { type: string; trace: Trace; settings: { threshold: number; autoSkip: boolean } }) => {
        if (message.type !== "trace") return;
        const video = document.querySelector("video");
        if (video && !bar) attach(video);
        scheduler?.setOptions(message.settings);
        scheduler?.setSlices(message.trace.slices);
        bar?.update(message.trace.slices, message.trace.duration || video?.duration || 0);
      },
    );

    document.addEventListener("yt-navigate-finish", () => void start());
    window.addEventListener("popstate", () => void start());
    void start();
    // Undo is also a keyboard action while the toast is up.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "z" || !lastSkip || Date.now() - lastSkip.at > 4000) return;
      const video = document.querySelector("video");
      if (video) video.currentTime = lastSkip.slice.start;
      document.querySelector(".jev-skip-toast")?.remove();
    });
  },
});
