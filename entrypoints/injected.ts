/**
 * Runs in the page world, where the player and BotGuard live. It does two things the
 * isolated content script cannot: see the caption URL the player signs, and read the page's
 * own ytInitialPlayerResponse for the title and duration.
 *
 * It reads; it never changes what the player does. The caption URL is the player's own
 * request, captured on the way past.
 */
export default defineUnlistedScript(() => {
  const CHANNEL = "jev-skip";

  const post = (payload: Record<string, unknown>) => {
    window.postMessage({ source: CHANNEL, ...payload }, location.origin);
  };

  // Only a pot-bearing URL is worth anything: the pot-less shape answers 200 with no body.
  const record = (raw: unknown) => {
    const url = typeof raw === "string" ? raw : (raw as Request | undefined)?.url;
    if (typeof url !== "string") return;
    if (!url.includes("/api/timedtext") || !url.includes("pot=")) return;
    post({ type: "caption-url", url });
  };

  const fetchImpl = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    try {
      record(args[0]);
    } catch {}
    return fetchImpl.apply(this as never, args);
  };

  const open = XMLHttpRequest.prototype.open;
  // Loosely typed on purpose: this stands in for both overloads of open().
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
    try {
      record(args[1]);
    } catch {}
    return open.apply(this, args as never);
  } as typeof open;

  const details = () => {
    const player = (window as { ytInitialPlayerResponse?: Record<string, any> })
      .ytInitialPlayerResponse;
    const video = player?.videoDetails;
    if (!video?.videoId) return null;
    return {
      videoId: video.videoId as string,
      title: (video.title as string) ?? "",
      channel: (video.author as string) ?? "",
      duration: Number(video.lengthSeconds ?? 0),
    };
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== `${CHANNEL}-ask`) return;
    if (event.data.type === "details") post({ type: "details", details: details() });
  });

  post({ type: "ready" });
});
