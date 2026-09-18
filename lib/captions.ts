import type { Cue } from "./types.ts";

interface CaptionTrack {
  baseUrl: string;
  kind?: string;
  languageCode?: string;
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

/** Manual English first, then auto English, then whatever exists. Null when the video has no track. */
export function pickCaptionTrack(player: PlayerResponse | null | undefined): CaptionTrack | null {
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) return null;
  const english = (t: CaptionTrack) => (t.languageCode ?? "").toLowerCase().startsWith("en");
  return (
    tracks.find((t) => english(t) && t.kind !== "asr") ??
    tracks.find((t) => english(t)) ??
    tracks[0] ??
    null
  );
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

/** json3 events to cues. Window-definition events carry no segs and are dropped. */
export function parseJson3(body: string): Cue[] | null {
  if (!body.trim()) return null;
  let parsed: { events?: Json3Event[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const cues: Cue[] = [];
  for (const event of parsed.events ?? []) {
    if (typeof event.tStartMs !== "number" || !event.segs) continue;
    const text = event.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = event.tStartMs / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  return cues.length ? cues : null;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Auto-captions repeat the tail of one cue as the head of the next. When a cue starts with
 * the last three or more words of the cue before it, that prefix goes; a cue left with
 * nothing goes entirely.
 */
export function dedupeRollingCues(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    let current = words(cue.text);
    if (prev) {
      const prevWords = words(prev.text);
      const max = Math.min(prevWords.length, current.length);
      for (let k = max; k >= 3; k--) {
        const tail = prevWords.slice(prevWords.length - k).map(bare).join(" ");
        const head = current.slice(0, k).map(bare).join(" ");
        if (tail === head) {
          current = current.slice(k);
          break;
        }
      }
    }
    if (!current.length) continue;
    out.push({ start: cue.start, end: cue.end, text: current.join(" ") });
  }
  return out;
}

/**
 * The timedtext URL is session-signed, so this only works from the watch tab. An empty
 * body means nothing to read: no bar, no request, and we cannot tell a caption-less video
 * apart from a session YouTube refused.
 */
export async function readCaptions(
  player: PlayerResponse | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Cue[] | null> {
  const track = pickCaptionTrack(player);
  if (!track?.baseUrl) return null;
  let body: string;
  try {
    const res = await fetchImpl(`${track.baseUrl}&fmt=json3`);
    if (!res.ok) return null;
    body = await res.text();
  } catch {
    return null;
  }
  const cues = parseJson3(body);
  return cues ? dedupeRollingCues(cues) : null;
}
