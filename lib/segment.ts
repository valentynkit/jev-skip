import type { Cue, Segment } from "./types.ts";

export interface SegmentOptions {
  /** Nominal window length in seconds. */
  target?: number;
  /** How far a boundary may move to land on a sentence end. */
  snap?: number;
  /** Hard cap on a window. */
  max?: number;
  /** A silence this long counts as a boundary even without punctuation. */
  gap?: number;
}

const SENTENCE_END = /[.!?]["')\]]?$/;
const URL_MARKER = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|co|gg|tv|app|dev|shop|ai)\b/i;
const LINK_MARKER = /\buse my link\b|\blink (?:in|below|down)\b|\bin the description below\b/i;
const CODE_MARKER =
  /\b(?:code|promo|coupon|discount)\b[^.?!]{0,40}?\b[A-Z0-9]{4,12}\b|\b[A-Z0-9]{4,12}\b[^.?!]{0,25}?\b(?:code|promo|coupon)\b/;

/**
 * The regex belt: markers code found, never a verdict. State carries it so Jev sees the
 * same evidence we do, and a false positive has to survive the section 5 fixture.
 */
export function hasPromoMarkers(text: string): boolean {
  return URL_MARKER.test(text) || LINK_MARKER.test(text) || CODE_MARKER.test(text);
}

interface Boundary {
  index: number;
  time: number;
  strong: boolean;
}

function boundaries(cues: Cue[], gap: number): Boundary[] {
  return cues.map((cue, i) => {
    const next = cues[i + 1];
    const silence = next ? next.start - cue.end : Infinity;
    return {
      index: i + 1,
      time: next ? Math.min(cue.end, next.start) : cue.end,
      strong: SENTENCE_END.test(cue.text) || silence > gap,
    };
  });
}

/**
 * 30-second windows snapped to the nearest sentence end. A window cut mid-sentence is the
 * likeliest cause of a bad label, so punctuation and silences win over the clock.
 */
export function segmentCues(cues: Cue[], options: SegmentOptions = {}): Segment[] {
  const { target = 30, snap = 8, max = 45, gap = 1.2 } = options;
  if (!cues.length) return [];
  const marks = boundaries(cues, gap);
  const segments: Segment[] = [];
  let from = 0;
  while (from < cues.length) {
    const start = cues[from].start;
    const wanted = start + target;
    const candidates = marks.filter((m) => m.index > from && m.time - start <= max);
    let chosen = candidates.find((m) => m.index === cues.length) ?? null;
    if (!chosen || chosen.time - start > target + snap) {
      const near = candidates.filter((m) => Math.abs(m.time - wanted) <= snap);
      chosen =
        near
          .filter((m) => m.strong)
          .sort((a, b) => Math.abs(a.time - wanted) - Math.abs(b.time - wanted))[0] ??
        near.sort((a, b) => Math.abs(a.time - wanted) - Math.abs(b.time - wanted))[0] ??
        candidates[candidates.length - 1] ??
        marks[from];
    }
    const to = Math.max(chosen.index, from + 1);
    const slice = cues.slice(from, to);
    const text = slice.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
    segments.push({
      id: `s${String(segments.length + 1).padStart(3, "0")}`,
      start: slice[0].start,
      end: Math.min(slice[slice.length - 1].end, slice[0].start + max),
      text,
      has_promo_markers: hasPromoMarkers(text),
    });
    from = to;
  }
  return segments;
}
