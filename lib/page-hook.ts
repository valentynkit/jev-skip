/**
 * The page world, where the player and BotGuard live. Two things the isolated content
 * script cannot do: see the caption URL the player signs, and read the page's own
 * ytInitialPlayerResponse.
 *
 * It reads; it never changes what the player does, except when asked to nudge captions on.
 *
 * Installed twice over, because the timing is the whole game: as a MAIN-world content
 * script on Chrome, which the browser runs before any page script, and as an injected file
 * on Firefox MV2, which has no MAIN world. Whichever lands first wins and the other sees
 * the flag and leaves.
 */
export function installPageHook(): boolean {
  const flag = "__jevSkipPageHook";
  const self = window as unknown as Record<string, unknown>;
  if (self[flag]) return false;
  self[flag] = true;

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

  /**
   * The player only signs a caption URL when it actually wants captions, which it does not
   * do for a viewer who keeps subtitles off. Asking it for a track makes it fetch one; the
   * previous selection goes back afterwards, so a viewer who had captions off still has
   * them off. Without this the extension only ever worked for people watching with
   * subtitles on.
   */
  function nudgeCaptions() {
    const player = document.querySelector("#movie_player") as
      | (Element & {
          getOption?: (a: string, b: string) => unknown;
          setOption?: (a: string, b: string, c: unknown) => void;
        })
      | null;
    if (!player?.getOption || !player.setOption) return "no player api";
    let tracks: any[];
    try {
      tracks = (player.getOption("captions", "tracklist") as any[]) ?? [];
    } catch {
      return "no tracklist";
    }
    if (!tracks.length) return "no tracks";
    const previous = (() => {
      try {
        return player.getOption("captions", "track");
      } catch {
        return null;
      }
    })();
    const hadOne = Boolean((previous as { languageCode?: string } | null)?.languageCode);
    try {
      player.setOption("captions", "track", tracks[0]);
    } catch {
      return "set failed";
    }
    if (!hadOne) {
      setTimeout(() => {
        try {
          player.setOption!("captions", "track", {});
        } catch {}
      }, 2500);
    }
    return `nudged ${tracks.length} tracks, restoring: ${!hadOne}`;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== `${CHANNEL}-ask`) return;
    if (event.data.type === "details") post({ type: "details", details: details() });
    if (event.data.type === "nudge") post({ type: "nudged", result: nudgeCaptions() });
  });

  post({ type: "ready" });

  return true;
}
