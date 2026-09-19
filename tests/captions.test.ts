import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dedupeRollingCues, parseJson3, pickCaptionTrack, readCaptions, toJson3, captionUrlVideoId, fetchCues } from "../lib/captions.ts";

const corpus = readFileSync("fixtures/videos/synthetic-radiator-shelf/captions.json3", "utf8");

const auto = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "and this is the part" }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "is the part where it goes wrong" }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: "where it goes wrong" }] },
    { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: "\n" }] },
  ],
});

describe("captions", () => {
  it("turns a json3 fixture into cues with the expected count and duration", () => {
    const cues = parseJson3(corpus)!;
    expect(cues).toHaveLength(16);
    expect(cues[0].start).toBe(0);
    expect(cues.at(-1)!.end).toBeCloseTo(158.2, 1);
    expect(cues[0].text.startsWith("I needed a shelf")).toBe(true);
  });

  it("drops the rolling tail auto-captions repeat, and empty cues with it", () => {
    const cues = dedupeRollingCues(parseJson3(auto)!);
    expect(cues.map((c) => c.text)).toEqual(["and this is the part", "where it goes wrong"]);
  });

  it("returns null for a caption-less video without throwing", async () => {
    expect(pickCaptionTrack({})).toBeNull();
    expect(pickCaptionTrack({ captions: { playerCaptionsTracklistRenderer: {} } })).toBeNull();
    expect(parseJson3("")).toBeNull();
    await expect(readCaptions(null)).resolves.toBeNull();
  });

  it("prefers a manual English track, then auto, then whatever exists", () => {
    const tracks = [
      { baseUrl: "a", languageCode: "de" },
      { baseUrl: "b", languageCode: "en", kind: "asr" },
      { baseUrl: "c", languageCode: "en" },
    ];
    const renderer = (captionTracks: typeof tracks) => ({
      captions: { playerCaptionsTracklistRenderer: { captionTracks } },
    });
    expect(pickCaptionTrack(renderer(tracks))!.baseUrl).toBe("c");
    expect(pickCaptionTrack(renderer(tracks.slice(0, 2)))!.baseUrl).toBe("b");
    expect(pickCaptionTrack(renderer(tracks.slice(0, 1)))!.baseUrl).toBe("a");
  });

  it("treats an empty 200 as nothing to read, so no request follows", async () => {
    const fetchImpl = async () => new Response("", { status: 200 });
    const player = renderedTrack();
    await expect(readCaptions(player, fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });
});

function renderedTrack() {
  return {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ baseUrl: "https://example.test/timedtext", languageCode: "en" }],
      },
    },
  };
}

describe("the URL the player signed", () => {
  const signed =
    "https://www.youtube.com/api/timedtext?v=4RcThoRG46c&caps=asr&fmt=srv3&pot=ABC&potc=1&c=WEB";

  it("swaps the format the player asked for without losing the token", () => {
    const json3 = toJson3(signed);
    expect(json3).toContain("fmt=json3");
    expect(json3).not.toContain("fmt=srv3");
    expect(json3).toContain("pot=ABC");
  });

  it("appends a format when the URL carries none", () => {
    expect(toJson3("https://www.youtube.com/api/timedtext?v=x&pot=A")).toBe(
      "https://www.youtube.com/api/timedtext?v=x&pot=A&fmt=json3",
    );
  });

  it("names the video a captured URL belongs to", () => {
    expect(captionUrlVideoId(signed)).toBe("4RcThoRG46c");
    expect(captionUrlVideoId("not a url")).toBe(null);
  });

  it("reads cues from a signed URL", async () => {
    const body = JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "hello there" }] }],
    });
    const fake = (async (url: string) => {
      expect(url).toContain("fmt=json3");
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const cues = await fetchCues(signed, fake);
    expect(cues).toStrictEqual([{ start: 0, end: 1, text: "hello there" }]);
  });

  it("gives up quietly when the signed URL fails", async () => {
    const fake = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    expect(await fetchCues(signed, fake)).toBe(null);
  });
});
