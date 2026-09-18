/**
 * Corpus curation and the recording proxy.
 *
 *   node scripts/record.ts --dry-run    select the corpus, print it, write nothing
 *   node scripts/record.ts --corpus     write fixtures/videos.json, captions and crowd files
 *   node scripts/record.ts              judge the corpus once, cache answers by request hash
 *   node scripts/record.ts --fake       same, answered by scripts/fake-jev.ts, no network
 *
 * Selection rule, rebuildable by anyone: walk SponsorBlock's k-anonymity endpoint by hash
 * prefix in ascending order, keep sponsor segments with locked=1 and votes>=5 on videos
 * 6 to 40 minutes long, one video per channel, sort by videoID ascending, take the first 30.
 * CONTEXT.md section 5 seeded this from the sponsorTimes.csv dump instead; the dump is
 * multi-GB and the prefix walk reads the same fields from the same database.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { callJev, type JevResponse } from "../lib/jev.ts";
import { buildRequests, type JevRequest } from "../lib/questions.ts";
import { parseJson3, dedupeRollingCues } from "../lib/captions.ts";
import { segmentCues } from "../lib/segment.ts";
import { startFakeJev } from "./fake-jev.ts";
import type { VideoInfo } from "../lib/types.ts";

const SB = "https://sponsor.ajay.app/api";
const WANT = 30;
const MIN_DURATION = 360;
const MAX_DURATION = 2400;
const MIN_VOTES = 5;
const FIXTURES = "fixtures";
const CATEGORIES = '["sponsor","selfpromo","intro","outro","preview"]';

export interface CorpusVideo extends VideoInfo {
  lang: string;
  synthetic?: boolean;
  note?: string;
  locked?: number;
  submitters?: number;
}

export function cacheKey(request: JevRequest): string {
  const blob = JSON.stringify({ state: request.state, questions: request.questions });
  return createHash("sha256").update(blob).digest("hex");
}

const json = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": "jev-skip corpus builder" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

interface CrowdSegment {
  startTime: number;
  endTime: number;
  category: string;
  votes: number;
  locked: number;
  userID: string;
}

async function crowd(videoId: string): Promise<{ segments: CrowdSegment[] }> {
  return json(`${SB}/searchSegments?videoID=${videoId}&categories=${encodeURIComponent(CATEGORIES)}&actionTypes=${encodeURIComponent('["skip"]')}`);
}

async function meta(videoId: string): Promise<{ title: string; channel: string } | null> {
  try {
    const data = await json(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    return { title: data.title, channel: data.author_name };
  } catch {
    return null;
  }
}

/** Ascending hash prefixes, so the sample is the database's order and not ours. */
async function* seed(): AsyncGenerator<{ videoId: string; duration: number }> {
  // A 4-hex prefix is 16^4 values. Stopping at 4096 walked a sixteenth of the space and
  // would have quietly returned a short corpus if that slice ever thinned out.
  for (let n = 0; n < 65536; n++) {
    const prefix = n.toString(16).padStart(4, "0");
    let rows: { videoID: string; segments: { videoDuration: number; locked: number; votes: number; category: string }[] }[];
    try {
      rows = await json(`${SB}/skipSegments/${prefix}?categories=${encodeURIComponent('["sponsor"]')}`);
    } catch {
      continue;
    }
    for (const row of rows.sort((a, b) => (a.videoID < b.videoID ? -1 : 1))) {
      const good = row.segments.find(
        (s) =>
          s.category === "sponsor" &&
          s.locked === 1 &&
          s.votes >= MIN_VOTES &&
          s.videoDuration >= MIN_DURATION &&
          s.videoDuration <= MAX_DURATION,
      );
      if (good) yield { videoId: row.videoID, duration: good.videoDuration };
    }
  }
}

export async function select(want = WANT, log = (line: string) => console.log(line)) {
  const picked: CorpusVideo[] = [];
  const channels = new Set<string>();
  let scanned = 0;
  for await (const candidate of seed()) {
    if (picked.length >= want) break;
    scanned += 1;
    const info = await meta(candidate.videoId);
    if (!info || channels.has(info.channel)) continue;
    // The guard re-reads the fields it will use, from the endpoint it will use.
    const data = await crowd(candidate.videoId).catch(() => null);
    const segments = data?.segments ?? [];
    const locked = segments.filter((s) => s.locked === 1).length;
    const submitters = new Set(segments.map((s) => s.userID)).size;
    if (!locked) continue;
    channels.add(info.channel);
    picked.push({
      videoId: candidate.videoId,
      title: info.title,
      channel: info.channel,
      duration: candidate.duration,
      lang: "en",
      locked,
      submitters,
    });
    log(
      `${picked.length.toString().padStart(2)}. ${candidate.videoId}  locked=${locked}  submitters=${submitters}  ${Math.round(candidate.duration)}s  ${info.channel}`,
    );
  }
  picked.sort((a, b) => (a.videoId < b.videoId ? -1 : 1));
  log(`${picked.length} selected from ${scanned} candidates`);
  return picked;
}

/** json3 ships styling and positioning we never read; the corpus keeps the three fields we do. */
export function minifyJson3(body: string): string {
  const events = (JSON.parse(body).events ?? [])
    .filter((event: { segs?: { utf8?: string }[] }) => event.segs?.some((s) => s.utf8?.trim()))
    .map((event: { tStartMs: number; dDurationMs?: number; segs: { utf8?: string }[] }) => ({
      tStartMs: event.tStartMs,
      dDurationMs: event.dDurationMs ?? 0,
      segs: [{ utf8: event.segs.map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim() }],
    }));
  return JSON.stringify({ events });
}

/**
 * Captions come from yt-dlp, not from the timedtext URL: that URL is session-signed and a
 * script outside the watch tab gets an empty 200 back (CONTEXT.md section 3).
 */
function captions(videoId: string, dir: string): boolean {
  try {
    execFileSync(
      "yt-dlp",
      [
        "--ignore-config",
        "--skip-download",
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang",
        "en.*",
        "--sub-format",
        "json3",
        "-o",
        `${dir}/%(id)s`,
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { stdio: "ignore", timeout: 120_000 },
    );
  } catch {
    return false;
  }
  const file = readdirSync(dir).find((name) => name.endsWith(".json3"));
  if (!file) return false;
  const body = readFileSync(`${dir}/${file}`, "utf8");
  if (!parseJson3(body)) return false;
  writeFileSync(`${dir}/captions.json3`, minifyJson3(body));
  for (const name of readdirSync(dir)) {
    if (name !== "captions.json3" && name !== "crowd.json") rmSync(`${dir}/${name}`);
  }
  return true;
}

async function buildCorpus(want: number) {
  const picked = await select(want);
  const kept: CorpusVideo[] = [];
  for (const video of picked) {
    const dir = `${FIXTURES}/videos/${video.videoId}`;
    mkdirSync(dir, { recursive: true });
    if (!captions(video.videoId, dir)) {
      console.log(`skip ${video.videoId}: no caption track we can read`);
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    writeFileSync(`${dir}/crowd.json`, JSON.stringify(await crowd(video.videoId), null, 1));
    kept.push(video);
    console.log(`corpus ${video.videoId}: captions + crowd`);
  }
  const existing: CorpusVideo[] = JSON.parse(readFileSync(`${FIXTURES}/videos.json`, "utf8"));
  const synthetic = existing.filter((v) => v.synthetic);
  writeFileSync(`${FIXTURES}/videos.json`, JSON.stringify([...kept, ...synthetic], null, 1));
  console.log(`${kept.length} real videos + ${synthetic.length} synthetic in fixtures/videos.json`);
}

export function corpusRequests(video: CorpusVideo, markers = true): JevRequest[] {
  const body = readFileSync(`${FIXTURES}/videos/${video.videoId}/captions.json3`, "utf8");
  const cues = dedupeRollingCues(parseJson3(body) ?? []);
  const segments = segmentCues(cues).map((s) =>
    markers ? s : { ...s, has_promo_markers: false },
  );
  return buildRequests(video, segments);
}

/** The arm that answers "does the regex belt help, or does it just muddy the claim". */
export const answersDir = (markers: boolean, fake: boolean) =>
  `${FIXTURES}/answers${fake ? "-fake" : ""}${markers ? "" : "-nomarkers"}`;

async function record(useFake: boolean, paceMs: number, markers: boolean) {
  const videos: CorpusVideo[] = JSON.parse(readFileSync(`${FIXTURES}/videos.json`, "utf8"));
  const fake = useFake ? await startFakeJev() : null;
  // Fake answers never share a directory with recorded ones: measure says which it scored.
  const outDir = answersDir(markers, useFake);
  mkdirSync(outDir, { recursive: true });
  const baseUrl = fake?.url ?? process.env.JEV_BASE_URL ?? "https://api.typesafe.ai";
  const apiKey = process.env.TYPESAFE_API_KEY ?? "shim-placeholder";
  let calls = 0;
  let tokens = 0;
  const failed: string[] = [];
  for (const video of videos) {
    for (const request of corpusRequests(video, markers)) {
      const key = cacheKey(request);
      const path = `${outDir}/${key}.json`;
      if (existsSync(path)) continue;
      const started = Date.now();
      let response: JevResponse;
      try {
        response = await callJev(request, { apiKey, baseUrl, timeoutMs: 180_000 });
      } catch (error) {
        // Keep going: a rate-limited chunk is a gap to fill on the next run, not a lost corpus.
        failed.push(video.videoId);
        console.log(`${video.videoId} failed: ${error instanceof Error ? error.message : error}`);
        if (paceMs) await new Promise((done) => setTimeout(done, paceMs));
        continue;
      }
      const elapsedMs = Date.now() - started;
      calls += 1;
      tokens += response.usage?.input_tokens ?? 0;
      writeFileSync(
        path,
        JSON.stringify(
          {
            videoId: video.videoId,
            model: response.model,
            elapsedMs,
            usage: response.usage,
            answers: response.answers,
          },
          null,
          1,
        ),
      );
      console.log(
        `${video.videoId} ${key.slice(0, 12)} ${Object.keys(response.answers).length} answers ${elapsedMs}ms`,
      );
      if (paceMs) await new Promise((done) => setTimeout(done, paceMs));
    }
  }
  await fake?.close();
  console.log(`${calls} request(s), ${tokens} input tokens, base ${baseUrl}`);
  if (failed.length) {
    console.log(`${failed.length} chunk(s) still missing: ${[...new Set(failed)].join(" ")}`);
    console.log("re-run npm run record to fill them; recorded answers are never fetched twice");
  }
}

if (process.argv[1]?.endsWith("record.ts")) {
  const args = process.argv.slice(2);
  const want = Number(args.find((a) => a.startsWith("--n="))?.slice(4) ?? WANT);
  if (args.includes("--dry-run")) await select(want);
  else if (args.includes("--corpus")) await buildCorpus(want);
  else
    await record(
      args.includes("--fake"),
      Number(args.find((a) => a.startsWith("--pace="))?.slice(7) ?? 3000),
      !args.includes("--no-markers"),
    );
}
