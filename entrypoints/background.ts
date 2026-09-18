import { callJev } from "../lib/jev.ts";
import { buildRequests, requestBudget } from "../lib/questions.ts";
import {
  DEFAULT_SETTINGS,
  TRACE_KEY,
  USD_PER_INPUT_TOKEN,
  emptyTrace,
  type Category,
  type Segment,
  type Settings,
  type Trace,
  type VideoInfo,
} from "../lib/types.ts";

interface JudgeMessage {
  type: "judge";
  video: VideoInfo;
  segments: Segment[];
}

type Message =
  | JudgeMessage
  | { type: "get-state" }
  | { type: "set-settings"; patch: Partial<Settings> };

export default defineBackground(() => {
  // Chrome keeps storage out of content scripts once this is set; Firefox ignores it and
  // content code still never reads storage or sees the key (unclutter entrypoints/background.ts:60-62).
  void browser.storage.local
    .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => undefined);

  let inFlight: AbortController | null = null;

  const settings = async (): Promise<Settings & { baseUrl: string }> => {
    const stored = await browser.storage.local.get([
      "apiKey",
      "threshold",
      "autoSkip",
      "baseUrl",
    ]);
    return {
      apiKey: typeof stored.apiKey === "string" ? stored.apiKey : DEFAULT_SETTINGS.apiKey,
      threshold:
        typeof stored.threshold === "number" ? stored.threshold : DEFAULT_SETTINGS.threshold,
      autoSkip: stored.autoSkip !== false,
      baseUrl: typeof stored.baseUrl === "string" && stored.baseUrl ? stored.baseUrl : "https://api.typesafe.ai",
    };
  };

  async function publish(trace: Trace, tabId?: number) {
    await browser.storage.session.set({ [TRACE_KEY]: trace });
    const { threshold, autoSkip } = await settings();
    const message = { type: "trace", trace, settings: { threshold, autoSkip } };
    browser.runtime.sendMessage(message).catch(() => undefined);
    if (tabId !== undefined) browser.tabs.sendMessage(tabId, message).catch(() => undefined);
  }

  async function judge(message: JudgeMessage, tabId?: number) {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    const { apiKey, baseUrl } = await settings();
    const trace: Trace = {
      ...emptyTrace(message.video.videoId),
      title: message.video.title,
      channel: message.video.channel,
      duration: message.video.duration,
      segmentCount: message.segments.length,
      status: "building",
    };
    await publish(trace, tabId);

    if (!apiKey) {
      trace.status = "error";
      trace.error = "no key: paste one in the popup";
      await publish(trace, tabId);
      return;
    }

    const requests = buildRequests(message.video, message.segments);
    trace.chunksTotal = requests.length;
    trace.estTokens = requests.reduce((sum, r) => sum + requestBudget(r).total, 0);
    trace.costUsd = trace.estTokens * USD_PER_INPUT_TOKEN;
    trace.status = "in_flight";
    trace.startedAt = Date.now();
    await publish(trace, tabId);

    const byId = new Map(message.segments.map((s) => [s.id, s]));
    let usedTokens = 0;
    for (const request of requests) {
      try {
        const response = await callJev(request, { apiKey, baseUrl, signal: controller.signal });
        usedTokens += response.usage?.input_tokens ?? 0;
        trace.model = response.model ?? trace.model;
        for (const [id, answer] of Object.entries(response.answers)) {
          const segment = byId.get(id);
          if (!segment || answer?.type !== "choice") continue;
          trace.slices.push({
            id,
            start: segment.start,
            end: segment.end,
            category: answer.choice as Category,
            p: answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0,
            text: segment.text,
          });
        }
      } catch (error) {
        // Fail open: a chunk nobody judged stays content, which means no skip.
        trace.error = error instanceof Error ? error.message : String(error);
      }
      trace.chunksDone += 1;
      trace.elapsedMs = Date.now() - trace.startedAt;
      trace.slices.sort((a, b) => a.start - b.start);
      if (usedTokens) {
        trace.estTokens = usedTokens;
        trace.costUsd = usedTokens * USD_PER_INPUT_TOKEN;
      }
      await publish(trace, tabId);
    }
    trace.status = trace.slices.length || !trace.error ? "done" : "error";
    trace.elapsedMs = Date.now() - trace.startedAt;
    await publish(trace, tabId);
  }

  browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (message.type === "judge") {
      void judge(message, sender.tab?.id);
      return false;
    }
    if (message.type === "get-state") {
      void (async () => {
        const stored = await browser.storage.session.get(TRACE_KEY);
        sendResponse({ settings: await settings(), trace: stored[TRACE_KEY] ?? emptyTrace() });
      })();
      return true;
    }
    if (message.type === "set-settings") {
      void (async () => {
        await browser.storage.local.set(message.patch);
        const next = await settings();
        sendResponse(next);
        const stored = await browser.storage.session.get(TRACE_KEY);
        const trace = (stored[TRACE_KEY] as Trace | undefined) ?? emptyTrace();
        const tabs = await browser.tabs.query({ url: "https://*.youtube.com/*" });
        for (const tab of tabs) {
          if (tab.id !== undefined)
            browser.tabs
              .sendMessage(tab.id, {
                type: "trace",
                trace,
                settings: { threshold: next.threshold, autoSkip: next.autoSkip },
              })
              .catch(() => undefined);
        }
      })();
      return true;
    }
    return false;
  });
});
