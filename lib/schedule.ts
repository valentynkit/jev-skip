import { PAINTED, type Slice } from "./types.ts";

/** Chrome seeks fast, Firefox does not (SponsorBlock src/content.ts:830-834). */
export const LEAD_MS = { chrome: 150, firefox: 600 };

export interface VideoLike extends EventTarget {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
}

export interface SchedulerOptions {
  threshold: number;
  autoSkip: boolean;
  leadMs?: number;
  /** YouTube runs ads through the same video element, on the ad's own clock. */
  adPlaying?: () => boolean;
  onSkip?: (slice: Slice) => void;
}

export interface Scheduler {
  setSlices(slices: Slice[]): void;
  setOptions(patch: Partial<SchedulerOptions>): void;
  /** Exposed for the test and the undo toast; nothing else calls it. */
  pending(): number | null;
  destroy(): void;
}

const EVENTS = ["seeked", "ratechange", "durationchange", "play", "pause"] as const;

/**
 * One armed timer, never a poll. Re-armed on the five events that can move the playhead,
 * and on every batch of answers.
 */
export function createScheduler(video: VideoLike, options: SchedulerOptions): Scheduler {
  let opts = { leadMs: LEAD_MS.chrome, ...options };
  let slices: Slice[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let armedFor: number | null = null;
  /** Segments this scheduler already skipped once. Going back in is a decision, not a miss. */
  const fired = new Set<string>();

  // ponytail: one threshold for all five skippable categories. Per-category thresholds wait
  // for the sweep in measure.json to show the categories actually separate.
  const skippable = (slice: Slice) =>
    PAINTED.includes(slice.category) && slice.p >= opts.threshold;

  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    armedFor = null;
  }

  function fire(slice: Slice) {
    clear();
    // Background tabs get their timers throttled while playback keeps running, so a timer
    // can land long after the segment is behind us. Seeking to its end would rewind.
    if (video.currentTime >= slice.end) {
      arm();
      return;
    }
    fired.add(slice.id);
    video.currentTime = slice.end;
    opts.onSkip?.(slice);
    arm();
  }

  function arm() {
    clear();
    // During an ad currentTime is the ad's, so any content timestamp looks overdue.
    if (!opts.autoSkip || video.paused || opts.adPlaying?.()) return;
    const now = video.currentTime;
    const next = slices
      .filter((s) => skippable(s) && s.end > now + 0.25 && !fired.has(s.id))
      .sort((a, b) => a.start - b.start)[0];
    if (!next) return;
    if (next.start <= now) {
      fire(next);
      return;
    }
    const rate = video.playbackRate > 0 ? video.playbackRate : 1;
    const delay = Math.max(0, ((next.start - now) / rate) * 1000 - opts.leadMs);
    armedFor = next.start;
    timer = setTimeout(() => fire(next), delay);
  }

  for (const event of EVENTS) video.addEventListener(event, arm);
  arm();

  return {
    setSlices(next) {
      slices = next;
      arm();
    },
    setOptions(patch) {
      opts = { ...opts, ...patch };
      arm();
    },
    pending: () => armedFor,
    destroy() {
      clear();
      for (const event of EVENTS) video.removeEventListener(event, arm);
    },
  };
}
