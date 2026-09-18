import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseJson3 } from "../lib/captions.ts";
import { segmentCues } from "../lib/segment.ts";
import { NOTE, buildRequests, estimateTokens, requestBudget } from "../lib/questions.ts";
import type { Segment, VideoInfo } from "../lib/types.ts";

const video: VideoInfo = {
  videoId: "synthetic-lamp-review",
  title: "Three desk lamps, one of them goes straight back",
  channel: "Bench and Bulb",
  duration: 345.9,
};
const cues = parseJson3(
  readFileSync("fixtures/videos/synthetic-lamp-review/captions.json3", "utf8"),
)!;
const segments = segmentCues(cues);

/** 75 minutes of speech at roughly 2.6 words a second. */
function longTranscript(): Segment[] {
  const sentence =
    "the arm holds its position without drifting down over a long afternoon of work and the finish stays put ";
  return Array.from({ length: 150 }, (_, i) => ({
    id: `s${String(i + 1).padStart(3, "0")}`,
    start: i * 30,
    end: i * 30 + 30,
    text: sentence.repeat(7),
    has_promo_markers: false,
  }));
}

describe("question builder", () => {
  it("keeps state plus the longest question under the 32k budget", () => {
    const [request] = buildRequests(video, segments);
    const budget = requestBudget(request);
    expect(budget.total).toBeLessThan(32_000);
    expect(request.state.note).toBe(NOTE);
    expect(request.state.segments[0].start).toBe("0:00");
  });

  it("splits a 75-minute transcript and sends every segment id exactly once", () => {
    const long = longTranscript();
    const requests = buildRequests(video, long);
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(requestBudget(request).total).toBeLessThan(32_000);
      expect(Object.keys(request.questions)).toEqual(request.state.segments.map((s) => s.id));
    }
    const ids = requests.flatMap((r) => Object.keys(r.questions));
    expect(ids).toEqual(long.map((s) => s.id));
    expect(new Set(ids).size).toBe(long.length);
  });

  it("never lets one chunk carry more than 90 segments", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      start: i,
      end: i + 1,
      text: "short",
      has_promo_markers: false,
    }));
    for (const request of buildRequests(video, many)) {
      expect(request.state.segments.length).toBeLessThanOrEqual(90);
    }
  });

  it("estimates tokens above a naive character count on JSON-heavy state", () => {
    const [request] = buildRequests(video, segments);
    const json = JSON.stringify(request.state);
    expect(estimateTokens(json)).toBeGreaterThan(json.length / 5);
  });
});
