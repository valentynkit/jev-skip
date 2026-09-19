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
  | { type: "set-settings"; patch: Partial<Settings> & { baseUrl?: string } };

export default defineBackground(() => {
  // Chrome keeps storage out of content scripts once this is set; Firefox ignores it and
  // content code still never reads storage or sees the key (unclutter entrypoints/background.ts:60-62).
  void browser.storage.local
    .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => undefined);

  let inFlight: AbortController | null = null;

  /**
   * The endpoint is configurable, and the key rides on every request to it. An http:// or
   * off-host value would hand the key to whoever answers, so a bad one falls back to the
   * default rather than being stored. Localhost is allowed for the shim, and only reachable
   * at all in a build made with JEV_ALLOW_LOCALHOST.
   */
  function validBaseUrl(value: unknown): string | null {
    if (typeof value !== "string" || !value) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  }

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
      baseUrl: validBaseUrl(stored.baseUrl) ?? "https://api.typesafe.ai",
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
      // Only our own extension pages change settings. A content script asking to move the
      // endpoint is a content script asking where to send the key. Checking sender.tab is
      // not enough: the popup opened in a tab has one, and an options page would too.
      const fromExtensionPage =
        sender.id === browser.runtime.id &&
        (sender.url ?? "").startsWith(browser.runtime.getURL("/" as never));
      if (!fromExtensionPage) return false;
      void (async () => {
        const patch: Partial<Settings> & { baseUrl?: string } = {};
        if (typeof message.patch.apiKey === "string") patch.apiKey = message.patch.apiKey;
        if (typeof message.patch.autoSkip === "boolean") patch.autoSkip = message.patch.autoSkip;
        if (typeof message.patch.threshold === "number") {
          patch.threshold = Math.min(0.99, Math.max(0.5, message.patch.threshold));
        }
        if ("baseUrl" in message.patch) {
          // An empty field means "back to the default", anything unusable is ignored.
          const raw = message.patch.baseUrl;
          const url = validBaseUrl(raw);
          if (url) patch.baseUrl = url;
          else if (raw === "") patch.baseUrl = "";
        }
        await browser.storage.local.set(patch);
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
