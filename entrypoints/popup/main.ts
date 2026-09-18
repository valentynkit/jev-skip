import { paintable, PAINT_FLOOR, MAX_OPACITY } from "../../lib/bar.ts";
import {
  CATEGORIES,
  CATEGORY_COLOR,
  TRACE_KEY,
  emptyTrace,
  formatTime,
  type Settings,
  type Trace,
} from "../../lib/types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  model: $("model"),
  title: $("title"),
  channel: $("channel"),
  segments: $("segments"),
  tokens: $("tokens"),
  cost: $("cost"),
  timeline: $("timeline"),
  end: $("end"),
  dot: $("dot"),
  status: $("status"),
  legend: $("legend"),
  threshold: $<HTMLInputElement>("threshold"),
  thresholdValue: $("thresholdValue"),
  autoSkip: $("autoSkip"),
  apiKey: $<HTMLInputElement>("apiKey"),
  baseUrl: $<HTMLInputElement>("baseUrl"),
};

let trace: Trace = emptyTrace();
let painted = new Set<string>();
let ticker: ReturnType<typeof setInterval> | null = null;

const thousands = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const money = (n: number) => (n === 0 ? "$0" : n < 0.0001 ? "<$0.0001" : `$${n.toFixed(4)}`);

function statusLine(): string {
  if (trace.status === "building") return "building request";
  if (trace.status === "in_flight") {
    const chunks = trace.chunksTotal > 1 ? ` · chunk ${trace.chunksDone + 1}/${trace.chunksTotal}` : "";
    return `in flight · ${Date.now() - trace.startedAt} ms${chunks}`;
  }
  if (trace.status === "done") return `done in ${trace.elapsedMs} ms · ${trace.slices.length} judged`;
  if (trace.status === "error") return trace.error ?? "failed, nothing skipped";
  return "idle";
}

/** Slices animate in as answers arrive: a new id starts collapsed and expands on the next frame. */
function renderTimeline() {
  const duration = trace.duration || trace.slices.at(-1)?.end || 0;
  const seen = new Set<string>();
  for (const slice of trace.slices) {
    if (!paintable(slice) || !duration) continue;
    seen.add(slice.id);
    if (painted.has(slice.id)) continue;
    painted.add(slice.id);
    const node = document.createElement("i");
    node.style.left = `${(slice.start / duration) * 100}%`;
    node.style.width = `${((slice.end - slice.start) / duration) * 100}%`;
    node.style.background = CATEGORY_COLOR[slice.category];
    node.style.setProperty("--o", String(Math.min(MAX_OPACITY, Math.max(PAINT_FLOOR, slice.p))));
    node.title = `${slice.category} ${Math.round(slice.p * 100)}% at ${formatTime(slice.start)}`;
    el.timeline.append(node);
    requestAnimationFrame(() => node.classList.add("in"));
  }
  if (!seen.size && !trace.slices.length) {
    el.timeline.replaceChildren();
    painted = new Set();
  }
  el.end.textContent = formatTime(duration);
}

function renderLegend() {
  const counts = new Map<string, number>();
  for (const slice of trace.slices) counts.set(slice.category, (counts.get(slice.category) ?? 0) + 1);
  el.legend.replaceChildren(
    ...CATEGORIES.map((category) => {
      const count = counts.get(category) ?? 0;
      const row = document.createElement("div");
      if (count) row.classList.add("has");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = CATEGORY_COLOR[category];
      const name = document.createElement("span");
      name.textContent = category;
      const value = document.createElement("span");
      value.className = "count";
      value.textContent = String(count);
      row.append(swatch, name, value);
      return row;
    }),
  );
}

function render() {
  el.model.textContent = trace.model || "jev-1.13.0";
  el.title.textContent = trace.title || "no video";
  el.channel.textContent = trace.channel || "open a YouTube watch page";
  el.segments.textContent = String(trace.segmentCount);
  el.tokens.textContent = thousands(trace.estTokens);
  el.cost.textContent = money(trace.costUsd);
  el.status.textContent = statusLine();
  el.dot.className = `dot${
    trace.status === "in_flight" || trace.status === "building"
      ? " live"
      : trace.status === "done"
        ? " done"
        : trace.status === "error"
          ? " error"
          : ""
  }`;
  renderTimeline();
  renderLegend();

  if (trace.status === "in_flight" && !ticker) ticker = setInterval(render, 100);
  if (trace.status !== "in_flight" && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function applySettings(settings: Settings & { baseUrl?: string }) {
  el.threshold.value = String(settings.threshold);
  el.thresholdValue.textContent = settings.threshold.toFixed(2);
  el.autoSkip.classList.toggle("on", settings.autoSkip);
  el.apiKey.value = settings.apiKey;
  if (settings.baseUrl) el.baseUrl.value = settings.baseUrl;
}

const save = (patch: Record<string, unknown>) =>
  browser.runtime.sendMessage({ type: "set-settings", patch });

el.threshold.addEventListener("input", () => {
  el.thresholdValue.textContent = Number(el.threshold.value).toFixed(2);
});
el.threshold.addEventListener("change", () => void save({ threshold: Number(el.threshold.value) }));
el.autoSkip.addEventListener("click", () => {
  const on = !el.autoSkip.classList.contains("on");
  el.autoSkip.classList.toggle("on", on);
  void save({ autoSkip: on });
});
el.apiKey.addEventListener("change", () => void save({ apiKey: el.apiKey.value.trim() }));
el.baseUrl.addEventListener("change", () => void save({ baseUrl: el.baseUrl.value.trim() }));

browser.runtime.onMessage.addListener((message: { type: string; trace?: Trace }) => {
  if (message.type === "trace" && message.trace) {
    if (message.trace.videoId !== trace.videoId) {
      painted = new Set();
      el.timeline.replaceChildren();
    }
    trace = message.trace;
    render();
  }
});

// Opened mid-request: storage.session carries the trace so the popup joins in progress.
void (async () => {
  const stored = await browser.storage.session.get(TRACE_KEY);
  if (stored[TRACE_KEY]) trace = stored[TRACE_KEY] as Trace;
  const state = (await browser.runtime.sendMessage({ type: "get-state" })) as
    | { settings: Settings & { baseUrl: string }; trace: Trace }
    | undefined;
  if (state?.settings) applySettings(state.settings);
  if (state?.trace) trace = state.trace;
  render();
})();
