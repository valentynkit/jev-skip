import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseJson3 } from "../lib/captions.ts";
import { hasPromoMarkers, segmentCues } from "../lib/segment.ts";

const cues = parseJson3(
  readFileSync("fixtures/videos/synthetic-lamp-review/captions.json3", "utf8"),
)!;
const segments = segmentCues(cues);
const SENTENCE_END = /[.!?]["')\]]?$/;

describe("segmenter", () => {
  it("lands every boundary on a sentence end when one exists within 8s", () => {
    for (const segment of segments) {
      const last = cues.filter((c) => c.end <= segment.end + 0.01).at(-1)!;
      const nearby = cues.filter(
        (c) => Math.abs(c.end - segment.end) <= 8 && SENTENCE_END.test(c.text),
      );
      if (nearby.length) expect(SENTENCE_END.test(last.text)).toBe(true);
    }
  });

  it("keeps windows near the target and never past the cap", () => {
    for (const segment of segments) {
      expect(segment.end - segment.start).toBeLessThanOrEqual(45);
    }
    const mean =
      segments.reduce((sum, s) => sum + (s.end - s.start), 0) / segments.length;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(45);
  });

  it("covers the transcript once, in order, with unique ids", () => {
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
    expect(segments.map((s) => s.start)).toEqual([...segments.map((s) => s.start)].sort((a, b) => a - b));
    const words = segments.map((s) => s.text).join(" ").split(/\s+/).length;
    expect(words).toBe(cues.map((c) => c.text).join(" ").split(/\s+/).length);
  });

  it("fires the promo belt on a known sponsor read and stays quiet on plain talk", () => {
    const sponsor = segments.find((s) => s.text.includes("nordpass dot com"))!;
    expect(sponsor.has_promo_markers).toBe(true);
    expect(hasPromoMarkers("use code LAMPS20 at checkout")).toBe(true);
    expect(hasPromoMarkers("the link is in the description below")).toBe(true);
    expect(hasPromoMarkers("visit example.com for the plans")).toBe(true);
    expect(hasPromoMarkers("I measured the draw at the wall and it sat under twelve watts")).toBe(
      false,
    );
  });

  it("moves a boundary off the clock and onto the nearest sentence end", () => {
    // Cues 2.5s long, sentences four cues wide: the raw 30s boundary falls mid-sentence.
    const built = Array.from({ length: 24 }, (_, i) => ({
      start: i * 2.5,
      end: i * 2.5 + 2.5,
      text: i % 4 === 3 ? `part ${i} of the thought.` : `part ${i} of the thought`,
    }));
    const [first] = segmentCues(built);
    expect(first.end % 10).toBeCloseTo(0, 5);
    expect(first.text.endsWith(".")).toBe(true);
    expect(Math.abs(first.end - 30)).toBeLessThanOrEqual(8);
  });

  it("returns nothing for an empty transcript", () => {
    expect(segmentCues([])).toEqual([]);
  });
});
