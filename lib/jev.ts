import type { JevRequest } from "./questions.ts";

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevResponse {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

export interface CallOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** One budget for the whole call, retries included. */
  timeoutMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  sleepImpl?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const TOO_BIG = /too (?:big|large|long)|exceed|context length|max(?:imum)? tokens/i;

export class JevError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    function done() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }
  });
}

function retryDelay(res: Response, attempt: number): number {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(res.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return 600 * 2 ** attempt;
}

function halves(request: JevRequest): [JevRequest, JevRequest] {
  const segments = request.state.segments;
  const mid = Math.max(1, Math.floor(segments.length / 2));
  const cut = (from: number, to: number): JevRequest => {
    const part = segments.slice(from, to);
    const ids = new Set(part.map((s) => s.id));
    return {
      ...request,
      state: { ...request.state, segments: part },
      questions: Object.fromEntries(
        Object.entries(request.questions).filter(([id]) => ids.has(id)),
      ),
    };
  };
  return [cut(0, mid), cut(mid, segments.length)];
}

/**
 * Backoff on 429 and 5xx only, split-and-retry on a too-big 400 (jev-guard src/jev.js:29-67,
 * every judge.py:184-190). Runs in the background worker; the key never leaves it.
 */
export async function callJev(request: JevRequest, options: CallOptions): Promise<JevResponse> {
  const {
    apiKey,
    baseUrl = "https://api.typesafe.ai",
    fetchImpl = fetch,
    timeoutMs = 30_000,
    maxAttempts = 3,
    signal,
    sleepImpl = sleep,
  } = options;
  const budget = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, budget]) : budget;
  return send(request, abort);

  async function send(body: JevRequest, abortSignal: AbortSignal): Promise<JevResponse> {
    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      res = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      if (res.ok || (res.status !== 429 && res.status < 500) || attempt >= maxAttempts - 1) break;
      const wait = retryDelay(res, attempt);
      await res.text().catch(() => {});
      await sleepImpl(wait, abortSignal);
    }
    if (res.ok) return (await res.json()) as JevResponse;

    const text = await res.text().catch(() => "");
    if (res.status === 400 && TOO_BIG.test(text) && body.state.segments.length > 1) {
      const [left, right] = halves(body);
      const [a, b] = [await send(left, abortSignal), await send(right, abortSignal)];
      return {
        model: a.model ?? b.model,
        answers: { ...a.answers, ...b.answers },
        usage: {
          input_tokens: (a.usage?.input_tokens ?? 0) + (b.usage?.input_tokens ?? 0),
          output_tokens: 0,
        },
      };
    }
    throw new JevError(`jev HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
}
