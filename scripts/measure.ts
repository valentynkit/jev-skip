/**
 * The headline number, offline, from fixtures/. Never the network.
 *
 *   node scripts/measure.ts
 *   node scripts/measure.ts --predictions fixtures/pred-greedy.json
 *
 * What agreement means here: crowd coverage is sparse, so an unlabeled second is unlabeled,
 * not confirmed content. Recall is scored on crowd-labeled seconds only, and the guard
 * counts seconds we would skip that fall in no crowd segment at all, over the dense subset.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PAINTED, USD_PER_INPUT_TOKEN, type Category } from "../lib/types.ts";
import { answersDir, cacheKey, corpusRequests, type CorpusVideo } from "./record.ts";

type Interval = [number, number];

/** Set when any answer came from scripts/fake-jev.ts, so no fake number ever reads as measured. */
let scoredWithFake = false;
let recordedChunks = 0;
let fakeChunks = 0;
/** Whatever answered, which is not always what we asked for: the shim replies typesafe-ai/jev. */
const answeringModels = new Set<string>();

const SPONSORISH: Category[] = ["sponsor", "self_promo"];
const CROWD_SPONSORISH = ["sponsor", "selfpromo"];
const SWEEP = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99];

const merge = (intervals: Interval[]): Interval[] => {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([span[0], span[1]]);
  }
  return out;
};
const total = (intervals: Interval[]) => merge(intervals).reduce((sum, [a, b]) => sum + b - a, 0);
const intersect = (a: Interval[], b: Interval[]): Interval[] => {
  const out: Interval[] = [];
  for (const [s1, e1] of merge(a))
    for (const [s2, e2] of merge(b)) {
      const lo = Math.max(s1, s2);
      const hi = Math.min(e1, e2);
      if (hi > lo) out.push([lo, hi]);
    }
  return out;
};
const subtract = (a: Interval[], b: Interval[]) => total(a) - total(intersect(a, b));
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
};

interface Prediction {
  category: Category;
  p: number;
  /** The whole distribution, because the sponsor mass is not 1 minus the top choice. */
  probabilities?: Partial<Record<Category, number>>;
}

/** What the model thinks is sponsor-ish, read off the distribution rather than inferred. */
const sponsorMass = (prediction: Prediction): number => {
  const dist = prediction.probabilities;
  if (!dist) return SPONSORISH.includes(prediction.category) ? prediction.p : 1 - prediction.p;
  return SPONSORISH.reduce((sum, category) => sum + (dist[category] ?? 0), 0);
};
interface AnswerFile {
  model?: string;
  usage?: { input_tokens?: number | null };
  elapsedMs?: number;
  answers: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }>;
}

interface Row {
  videoId: string;
  lang: string;
  synthetic: boolean;
  duration: number;
  dense: boolean;
  fake: boolean;
  crowdSponsorSeconds: number;
  caughtSeconds: number;
  skipSeconds: number;
  /** Seconds the extension would actually cut, across all five painted categories. */
  skippedSeconds: number;
  falseSkipSeconds: number;
  unionSeconds: number;
  intersectionSeconds: number;
  tokens: number;
  elapsedMs: number;
  segments: { p: number; sponsorish: boolean; labelled: boolean; crowdSponsorish: boolean }[];
}

function predictionsFor(
  video: CorpusVideo,
  override: { default?: Prediction; videos?: Record<string, Record<string, Prediction>> } | null,
): { byId: Map<string, Prediction>; tokens: number; elapsedMs: number; missing: string[]; fake: boolean } {
  let usedFake = false;
  const byId = new Map<string, Prediction>();
  const missing: string[] = [];
  let tokens = 0;
  let elapsedMs = 0;
  for (const request of corpusRequests(video, markers)) {
    const ids = Object.keys(request.questions);
    if (override) {
      for (const id of ids)
        byId.set(id, override.videos?.[video.videoId]?.[id] ?? override.default ?? { category: "content", p: 0.9 });
      continue;
    }
    const key = cacheKey(request);
    const path = [answersDir(markers, false), answersDir(markers, true)]
      .map((dir) => `${dir}/${key}.json`)
      .find(existsSync);
    if (!path) {
      missing.push(`${answersDir(markers, false)}/${key}.json`);
      continue;
    }
    if (path.includes("-fake")) {
      usedFake = true;
      fakeChunks += 1;
    } else recordedChunks += 1;
    const file: AnswerFile = JSON.parse(readFileSync(path, "utf8"));
    if (file.model) answeringModels.add(file.model);
    tokens += file.usage?.input_tokens ?? 0;
    elapsedMs = Math.max(elapsedMs, file.elapsedMs ?? 0);
    for (const [id, answer] of Object.entries(file.answers)) {
      byId.set(id, {
        category: answer.choice as Category,
        p: answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0,
        probabilities: answer.probabilities as Partial<Record<Category, number>> | undefined,
      });
    }
  }
  if (usedFake) scoredWithFake = true;
  return { byId, tokens, elapsedMs, missing, fake: usedFake };
}

function score(act: number, override: Parameters<typeof predictionsFor>[1]) {
  const videos: CorpusVideo[] = JSON.parse(readFileSync("fixtures/videos.json", "utf8"));
  const rows: Row[] = [];
  const missing: string[] = [];
  for (const video of videos) {
    const crowdPath = `fixtures/videos/${video.videoId}/crowd.json`;
    if (!existsSync(crowdPath)) continue;
    const crowd = JSON.parse(readFileSync(crowdPath, "utf8")).segments as {
      startTime: number;
      endTime: number;
      category: string;
      locked: number;
      userID: string;
    }[];
    const prediction = predictionsFor(video, override);
    missing.push(...prediction.missing);
    if (!prediction.byId.size) continue;

    const segments = corpusRequests(video, markers).flatMap((request) =>
      request.state.segments.map((s) => {
        const [m, sec] = s.start.split(":").map(Number);
        return { id: s.id, start: m * 60 + sec };
      }),
    );
    const bounds: Interval[] = segments.map((s, i) => [
      s.start,
      i + 1 < segments.length ? segments[i + 1].start : video.duration,
    ]);

    const crowdAll: Interval[] = crowd.map((c) => [c.startTime, c.endTime]);
    const crowdSponsor: Interval[] = crowd
      .filter((c) => CROWD_SPONSORISH.includes(c.category))
      .map((c) => [c.startTime, c.endTime]);

    const predicted: Interval[] = [];
    // What the extension would actually cut: lib/schedule.ts skips every painted category
    // at one threshold, not just the sponsor-ish pair the recall number is scored on.
    const skipped: Interval[] = [];
    const segmentScores: Row["segments"] = [];
    segments.forEach((segment, i) => {
      const answer = prediction.byId.get(segment.id);
      if (!answer) return;
      const span = bounds[i];
      const sponsorish = SPONSORISH.includes(answer.category);
      if (sponsorish && answer.p >= act) predicted.push(span);
      if (PAINTED.includes(answer.category) && answer.p >= act) skipped.push(span);
      segmentScores.push({
        p: sponsorMass(answer),
        sponsorish,
        labelled: total(intersect([span], crowdAll)) > 0,
        crowdSponsorish: total(intersect([span], crowdSponsor)) > (span[1] - span[0]) / 4,
      });
    });

    rows.push({
      videoId: video.videoId,
      lang: video.lang ?? "en",
      synthetic: Boolean(video.synthetic),
      duration: video.duration,
      dense:
        crowd.some((c) => c.locked === 1) && new Set(crowd.map((c) => c.userID)).size >= 3,
      fake: prediction.fake,
      crowdSponsorSeconds: total(crowdSponsor),
      caughtSeconds: total(intersect(predicted, crowdSponsor)),
      skipSeconds: total(predicted),
      falseSkipSeconds: subtract(skipped, crowdAll),
      skippedSeconds: total(skipped),
      unionSeconds: total([...predicted, ...crowdSponsor]),
      intersectionSeconds: total(intersect(predicted, crowdSponsor)),
      tokens: prediction.tokens,
      elapsedMs: prediction.elapsedMs,
      segments: segmentScores,
    });
  }
  return { rows, missing };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function summarise(rows: Row[]) {
  const labelled = rows.filter((r) => r.crowdSponsorSeconds > 0);
  const crowdSeconds = sum(labelled.map((r) => r.crowdSponsorSeconds));
  const caught = sum(labelled.map((r) => r.caughtSeconds));
  const dense = rows.filter((r) => r.dense);
  const denseHours = sum(dense.map((r) => r.duration)) / 3600;
  return {
    n: rows.length,
    crowdSeconds,
    recall: crowdSeconds ? caught / crowdSeconds : 0,
    denseN: dense.length,
    falseSkipPerHour: denseHours ? sum(dense.map((r) => r.falseSkipSeconds)) / denseHours : 0,
    iou:
      sum(rows.map((r) => r.unionSeconds)) > 0
        ? sum(rows.map((r) => r.intersectionSeconds)) / sum(rows.map((r) => r.unionSeconds))
        : 0,
    meanTokens: rows.length ? sum(rows.map((r) => r.tokens)) / rows.length : 0,
    costPerVideo: rows.length
      ? (sum(rows.map((r) => r.tokens)) / rows.length) * USD_PER_INPUT_TOKEN
      : 0,
    p50FirstPaint: median(rows.map((r) => r.elapsedMs).filter(Boolean)) / 1000,
  };
}

function calibration(rows: Row[]) {
  const points = rows.flatMap((r) => r.segments).filter((s) => s.labelled);
  const brier = points.length
    ? sum(points.map((s) => (s.p - (s.crowdSponsorish ? 1 : 0)) ** 2)) / points.length
    : 0;
  const bins = Array.from({ length: 10 }, () => [] as typeof points);
  for (const point of points) bins[Math.min(9, Math.floor(point.p * 10))].push(point);
  return {
    n: points.length,
    brier,
    reliability: bins
      .map((bin, i) => ({
        bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
        meanPredicted: bin.length ? sum(bin.map((s) => s.p)) / bin.length : 0,
        meanActual: bin.length ? sum(bin.map((s) => (s.crowdSponsorish ? 1 : 0))) / bin.length : 0,
        count: bin.length,
      }))
      .filter((bin) => bin.count),
  };
}

const args = process.argv.slice(2);
const predictionsFile = args.includes("--predictions") ? args[args.indexOf("--predictions") + 1] : null;
/** --no-markers scores the arm recorded without the regex belt in state. */
const markers = !args.includes("--no-markers");
/** --recorded-only drops every video whose answers are not all from a real endpoint. */
const recordedOnly = args.includes("--recorded-only");
const override = predictionsFile ? JSON.parse(readFileSync(predictionsFile, "utf8")) : null;
const thresholds = existsSync("thresholds.json")
  ? JSON.parse(readFileSync("thresholds.json", "utf8"))
  : null;
const act = thresholds?.act ?? 0.85;

const { rows, missing } = score(act, override);
if (!rows.length) {
  console.error(
    missing.length
      ? `no recorded answers: run npm run record${markers ? "" : " -- --no-markers"} (missing ${missing.length} file(s), first ${missing[0]})`
      : "no scorable videos in fixtures/videos.json",
  );
  process.exit(2);
}

const scored = recordedOnly && !override ? rows.filter((r) => !r.fake) : rows;
const real = scored.filter((r) => !r.synthetic && r.lang === "en");
const headlineRows = real.length ? real : scored.filter((r) => r.lang === "en");
const mixed = recordedChunks && fakeChunks && !recordedOnly;
const corpusLabel = predictionsFile
  ? `predictions from ${predictionsFile}`
  : mixed
    ? `mixed: ${recordedChunks} recorded chunks, ${fakeChunks} fake`
    : recordedOnly
      ? "recorded fixtures"
      : scoredWithFake
  ? "fake answers, not the model"
  : real.length
    ? "recorded fixtures"
    : "synthetic fixtures";
const model = answeringModels.size
  ? [...answeringModels].sort().join(", ")
  : (thresholds?.model ?? "jev-1.13.0");
const main = summarise(headlineRows);
const sweep = SWEEP.map((t) => {
  const rowsAt = score(t, override).rows.filter((r) => (recordedOnly && !override ? !r.fake : true));
  const summary = summarise(rowsAt.filter((r) => (real.length ? !r.synthetic : true) && r.lang === "en"));
  return { threshold: t, recall: summary.recall, falseSkipPerHour: summary.falseSkipPerHour };
});
const weakSpots = scored.filter((r) => r.lang !== "en").map((r) => ({
  videoId: r.videoId,
  lang: r.lang,
  recall: r.crowdSponsorSeconds ? r.caughtSeconds / r.crowdSponsorSeconds : 0,
}));

const pct = (value: number) => (value * 100).toFixed(1);
console.log(
  `${pct(main.recall)}% of crowd-labeled sponsor seconds caught (n=${main.n} videos / ${Math.round(main.crowdSeconds).toLocaleString("en-US")} labeled seconds, ${corpusLabel}, ${model})`,
);
console.log(
  `${main.falseSkipPerHour.toFixed(1)}s false-skip per hour, upper bound (n=${main.denseN} dense-subset videos)`,
);
console.log(
  `$${main.costPerVideo.toFixed(4)} per video (n=${main.n}, mean ${(main.meanTokens / 1000).toFixed(1)}k input tokens)`,
);
console.log(`${main.p50FirstPaint.toFixed(1)}s p50 to first painted segment (n=${main.n}, single request)`);

writeFileSync(
  markers ? "measure.json" : "measure-nomarkers.json",
  JSON.stringify(
    {
      model,
      act,
      has_promo_markers: markers,
      corpus: corpusLabel,
      recorded_chunks: recordedChunks,
      fake_chunks: fakeChunks,
      headline: main,
      iou_pessimistic: main.iou,
      sweep,
      calibration: calibration(headlineRows),
      weak_spots: weakSpots,
      videos: scored.map(({ segments, ...row }) => row),
    },
    null,
    1,
  ),
);

if (!thresholds) {
  console.log("unlocked, no gate (thresholds.json absent, nothing earned yet)");
  process.exit(0);
}
const failures: string[] = [];
if (main.recall < thresholds.recall_floor)
  failures.push(`recall ${pct(main.recall)}% below floor ${pct(thresholds.recall_floor)}%`);
if (main.falseSkipPerHour > thresholds.false_skip_ceiling_per_hour)
  failures.push(
    `false-skip ${main.falseSkipPerHour.toFixed(1)}s/h above ceiling ${thresholds.false_skip_ceiling_per_hour}s/h`,
  );
for (const failure of failures) console.error(`gate: ${failure}`);
process.exit(failures.length ? 1 : 0);
