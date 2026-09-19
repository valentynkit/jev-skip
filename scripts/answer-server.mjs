// Serves the answers recorded on 2026-09-18 back to the live extension, so the pipeline
// runs end to end with real Jev output and no key. Speaks the same wire format as the API.
//
//   node scripts/answer-server.mjs [--port 4333]
//   then set the popup's endpoint to http://127.0.0.1:4333
//
// This is a replay, not a call. It answers only for videos in fixtures/videos.json, and a
// segment it has no recording for comes back as content, which means no skip.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseJson3, dedupeRollingCues } from "../lib/captions.ts";
import { segmentCues } from "../lib/segment.ts";
import { CATEGORIES } from "../lib/types.ts";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(portIndex === -1 ? 4333 : args[portIndex + 1]);

/** videoId -> { segmentId -> answer }, rebuilt from the recorded chunks. */
const recorded = new Map();
/** videoId -> how long the recorded call actually took, so a replay is not unrealistically fast. */
const recordedLatency = new Map();
/** videoId -> the input tokens the recorded call actually billed, so the cost on screen is real. */
const recordedTokens = new Map();
for (const file of readdirSync("fixtures/answers")) {
  const payload = JSON.parse(readFileSync(join("fixtures/answers", file), "utf8"));
  if (!payload.videoId) continue;
  const bucket = recorded.get(payload.videoId) ?? {};
  Object.assign(bucket, payload.answers);
  recorded.set(payload.videoId, bucket);
  recordedLatency.set(
    payload.videoId,
    Math.max(recordedLatency.get(payload.videoId) ?? 0, payload.elapsedMs ?? 0),
  );
  recordedTokens.set(
    payload.videoId,
    (recordedTokens.get(payload.videoId) ?? 0) + (payload.usage?.input_tokens ?? 0),
  );
}

/** The text of each recorded segment, so an answer can be found when ids drift. */
const byText = new Map();
const videos = JSON.parse(readFileSync("fixtures/videos.json", "utf8"));
for (const video of videos) {
  if (!recorded.has(video.videoId)) continue;
  let cues;
  try {
    cues = dedupeRollingCues(
      parseJson3(readFileSync(`fixtures/videos/${video.videoId}/captions.json3`, "utf8")) ?? [],
    );
  } catch {
    continue;
  }
  const answers = recorded.get(video.videoId);
  const map = new Map();
  for (const segment of segmentCues(cues)) {
    const answer = answers[segment.id];
    if (answer) map.set(normalise(segment.text), answer);
  }
  byText.set(video.videoId, map);
}

function normalise(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

const content = () => {
  const rest = 0.02 / (CATEGORIES.length - 1);
  return {
    type: "choice",
    choice: "content",
    confidence: 0.98,
    probabilities: Object.fromEntries(
      CATEGORIES.map((c) => [c, Number((c === "content" ? 0.98 : rest).toFixed(4))]),
    ),
  };
};

console.error(
  `replaying ${recorded.size} videos: ${[...recorded.keys()].slice(0, 5).join(", ")}${recorded.size > 5 ? ", ..." : ""}`,
);

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let request;
    try {
      request = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad json" }));
      return;
    }

    const segments = request.state?.segments ?? [];
    // The title is the only thing in the request that names the video.
    const title = request.state?.video_title ?? "";
    const video = videos.find((v) => v.title === title) ?? null;
    const answers = video ? (recorded.get(video.videoId) ?? {}) : {};
    const texts = video ? (byText.get(video.videoId) ?? new Map()) : new Map();

    let hits = 0;
    let byTextHits = 0;
    const out = {};
    for (const id of Object.keys(request.questions ?? {})) {
      const segment = segments.find((s) => s.id === id);
      const direct = answers[id];
      const fallback = segment ? texts.get(normalise(segment.text)) : undefined;
      if (direct) hits += 1;
      else if (fallback) byTextHits += 1;
      // Nothing recorded for this segment: content, which is never skipped.
      out[id] = direct ?? fallback ?? content();
    }
    console.error(
      `${video ? video.videoId : "unknown video"}: ${Object.keys(out).length} questions, ${hits} by id, ${byTextHits} by text, ${Object.keys(out).length - hits - byTextHits} unanswered`,
    );

    // Answer no faster than the recorded call did: a 9ms reply would put a number on
    // screen that no real request could produce.
    const delay = recordedLatency.get(video?.videoId) ?? 700;
    setTimeout(() => {
    res.writeHead(200, {
      "content-type": "application/json",
      // The extension calls from an extension origin, so the replay has to allow it.
      "access-control-allow-origin": "*",
    });
    res.end(
      JSON.stringify({
        model: "typesafe-ai/jev (recorded 2026-09-18, replayed)",
        answers: out,
        usage: {
          // The tokens the recorded call actually billed, so the popup's cost is the
          // measured one rather than a guess made from string lengths.
          input_tokens:
            recordedTokens.get(video?.videoId) ??
            segments.reduce((sum, s) => sum + Math.ceil(s.text.length / 4), 0),
          output_tokens: 0,
        },
      }),
    );
    }, delay);
  });
}).listen(port, "127.0.0.1", () => console.error(`answer replay on http://127.0.0.1:${port}`));
