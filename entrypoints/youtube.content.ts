import { captionUrlVideoId, fetchCues } from "../lib/captions.ts";
import { segmentCues } from "../lib/segment.ts";
import { mountBar, type BarHandle } from "../lib/bar.ts";
import { LEAD_MS, createScheduler, type Scheduler } from "../lib/schedule.ts";
import type { Slice, Trace, VideoInfo } from "../lib/types.ts";

export default defineContentScript({
  matches: ["https://*.youtube.com/*"],
  // The page script has to hook fetch before the player asks for captions, so this runs
  // as early as the browser allows. Everything touching the DOM waits for its element.
  runAt: "document_start",
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
      // Undo across a navigation would seek this video to the other video's timestamp.
      lastSkip = null;
      document.querySelector(".jev-skip-toast")?.remove();
    }

    function toast(slice: Slice) {
      document.querySelector(".jev-skip-toast")?.remove();
      const node = document.createElement("div");
      node.className = "jev-skip-toast";
      // Inside the player when there is one: bottom 11% of the window put it over the page
      // below the video, next to the Download button, which is where the first take caught it.
      const host = document.querySelector<HTMLElement>(".html5-video-player") ?? document.body;
      const inPlayer = host !== document.body;
      node.style.cssText =
        `position:${inPlayer ? "absolute" : "fixed"};left:50%;bottom:${inPlayer ? "13%" : "11%"};transform:translateX(-50%);z-index:2147483647;` +
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
      host.append(node);
      setTimeout(() => {
        node.style.opacity = "0";
        setTimeout(() => node.remove(), 400);
      }, 4000);
      lastSkip = { at: Date.now(), slice };
    }

    function attach(video: HTMLVideoElement) {
      const progress = document.querySelector<HTMLElement>(".ytp-progress-bar");
      if (!progress || bar) return;
      // ?jevdemo on the watch URL slows the paint-in for a screen recording. It changes
      // nothing else: same answers, same timings, same skips.
      const demo = new URL(location.href).searchParams.has("jevdemo");
      bar = mountBar(progress, demo ? { paintInMs: 1400 } : {});
      scheduler = createScheduler(video, {
        threshold: 0.85,
        autoSkip: true,
        leadMs: firefox ? LEAD_MS.firefox : LEAD_MS.chrome,
        adPlaying: () => !!document.querySelector(".ad-showing, .ad-interrupting"),
        onSkip: toast,
      });
    }

    /** Caption URLs the player signed, by video id. See docs/browser-ground-truth.md. */
    const captionUrls = new Map<string, string>();
    const waiting = new Map<string, (url: string) => void>();
    let pageDetails: VideoInfo | null = null;

    // The page world reaches us only through postMessage, so everything here is untrusted
    // input from a page that could be anything: check the shape before believing it.
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== "jev-skip") return;
      const { type } = event.data;
      if (type === "caption-url" && typeof event.data.url === "string") {
        const videoId = captionUrlVideoId(event.data.url);
        if (!videoId) return;
        captionUrls.set(videoId, event.data.url);
        waiting.get(videoId)?.(event.data.url);
      }
      if (type === "details" && event.data.details?.videoId) {
        const d = event.data.details;
        pageDetails = {
          videoId: String(d.videoId),
          title: String(d.title ?? ""),
          channel: String(d.channel ?? ""),
          duration: Number(d.duration) || 0,
        };
      }
    });

    /**
     * The player signs a caption URL only when it wants captions itself. If it has not
     * asked within a few seconds, we ask it to load a track and put the old selection back.
     */
    function signedCaptionUrl(videoId: string, timeoutMs = 12_000): Promise<string | null> {
      const known = captionUrls.get(videoId);
      if (known) return Promise.resolve(known);
      return new Promise((resolve) => {
        const nudge = setTimeout(() => askPage("nudge"), 3_000);
        const timer = setTimeout(() => {
          waiting.delete(videoId);
          resolve(null);
        }, timeoutMs);
        waiting.set(videoId, (url) => {
          clearTimeout(nudge);
          clearTimeout(timer);
          waiting.delete(videoId);
          resolve(url);
        });
      });
    }

    function askPage(type: string) {
      window.postMessage({ source: "jev-skip-ask", type }, location.origin);
    }

    /** The page answers asynchronously, so reading pageDetails straight after asking races it. */
    function askDetails(videoId: string, timeoutMs = 2_500): Promise<VideoInfo | null> {
      if (pageDetails?.videoId === videoId) return Promise.resolve(pageDetails);
      return new Promise((resolve) => {
        const done = (value: VideoInfo | null) => {
          clearTimeout(timer);
          clearInterval(poll);
          resolve(value);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        const poll = setInterval(() => {
          if (pageDetails?.videoId === videoId) done(pageDetails);
        }, 100);
        askPage("details");
      });
    }

    /** The progress bar does not exist at document_start, and not during an ad either. */
    async function waitForProgressBar(timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const progress = document.querySelector<HTMLElement>(".ytp-progress-bar");
        const video = document.querySelector("video");
        if (progress && video) return video;
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
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

      const url = await signedCaptionUrl(videoId);
      // No signed URL means no readable captions: no bar, no request.
      if (!url || currentId !== videoId) return;
      const cues = await fetchCues(url);
      if (!cues?.length || currentId !== videoId) return;

      const [details, video] = await Promise.all([askDetails(videoId), waitForProgressBar()]);
      if (currentId !== videoId) return;
      if (video) attach(video);

      const info: VideoInfo = {
        videoId,
        title: details?.title || document.title.replace(/ - YouTube$/, ""),
        channel: details?.channel ?? "",
        duration: details?.duration || video?.duration || 0,
      };
      browser.runtime.sendMessage({ type: "judge", video: info, segments: segmentCues(cues) });
    }

    browser.runtime.onMessage.addListener(
      (message: { type: string; trace: Trace; settings: { threshold: number; autoSkip: boolean } }) => {
        if (message.type !== "trace") return;
        // The worker broadcasts, so every YouTube tab hears every trace. Another tab's
        // timestamps would arm a skip against this video.
        if (message.trace.videoId && message.trace.videoId !== currentId) return;
        const video = document.querySelector("video");
        if (video && !bar) attach(video);
        scheduler?.setOptions(message.settings);
        scheduler?.setSlices(message.trace.slices);
        bar?.update(message.trace.slices, message.trace.duration || video?.duration || 0);
      },
    );

    // A file, not an inline string: YouTube's CSP refuses inline script.
    const page = document.createElement("script");
    page.src = browser.runtime.getURL("/injected.js" as never);
    page.addEventListener("load", () => page.remove());
    (document.head ?? document.documentElement).append(page);

    document.addEventListener("yt-navigate-finish", () => void start());
    window.addEventListener("popstate", () => void start());
    void start();
    // Undo is also a keyboard action while the toast is up.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "z" || !lastSkip || Date.now() - lastSkip.at > 4000) return;
      // Cmd-Z in the comment box is not a request to rewind the video.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.isContentEditable || /^(input|textarea|select)$/i.test(focused?.tagName ?? "")) return;
      const video = document.querySelector("video");
      if (video) video.currentTime = lastSkip.slice.start;
      document.querySelector(".jev-skip-toast")?.remove();
    });
  },
});
