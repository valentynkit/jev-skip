/** Shared shapes. The content script, the background worker and the popup all speak these. */

export const CATEGORIES = [
  "content",
  "sponsor",
  "intro",
  "outro",
  "self_promo",
  "recap",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** One hue per category. content and other are never painted; their colors are for the legend. */
export const CATEGORY_COLOR: Record<Category, string> = {
  sponsor: "#ff4d6a",
  self_promo: "#ff9f43",
  intro: "#a98cff",
  outro: "#4cc9f0",
  recap: "#f7d154",
  content: "#4ade80",
  other: "#8b93a7",
};

export const PAINTED: Category[] = ["sponsor", "self_promo", "intro", "outro", "recap"];

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  has_promo_markers: boolean;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
}

/** One judged segment: the top category and its probability. */
export interface Slice {
  id: string;
  start: number;
  end: number;
  category: Category;
  p: number;
  text: string;
}

export type TraceStatus = "idle" | "building" | "in_flight" | "done" | "error";

/** What the popup renders. Written to storage.session and broadcast on every change. */
export interface Trace {
  videoId: string;
  title: string;
  channel: string;
  status: TraceStatus;
  /** What the endpoint answered with, which is not always what we asked for. */
  model: string;
  segmentCount: number;
  estTokens: number;
  costUsd: number;
  chunksTotal: number;
  chunksDone: number;
  startedAt: number;
  elapsedMs: number;
  duration: number;
  slices: Slice[];
  error?: string;
}

export const TRACE_KEY = "trace";
/** $0.042 per million input tokens, output free (research/01 section 1). */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export interface Settings {
  apiKey: string;
  threshold: number;
  autoSkip: boolean;
}

export const DEFAULT_SETTINGS: Settings = { apiKey: "", threshold: 0.85, autoSkip: true };

export function emptyTrace(videoId = ""): Trace {
  return {
    videoId,
    title: "",
    channel: "",
    status: "idle",
    model: "",
    segmentCount: 0,
    estTokens: 0,
    costUsd: 0,
    chunksTotal: 0,
    chunksDone: 0,
    startedAt: 0,
    elapsedMs: 0,
    duration: 0,
    slices: [],
  };
}
