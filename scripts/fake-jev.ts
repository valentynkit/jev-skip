/**
 * Fake Jev (research/01 section 3). Answers come from a fixture file when one names the
 * question, otherwise from the keyword heuristic below.
 *
 * ponytail: the heuristic is a stand-in for the model, not a model. It exists so tests and
 * `record --fake` run offline; every number it produces is labelled as coming from the fake.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { CATEGORIES, type Category } from "../lib/types.ts";
import type { JevRequest } from "../lib/questions.ts";
import type { ChoiceAnswer } from "../lib/jev.ts";

const RULES: [Category, RegExp, number][] = [
  [
    "sponsor",
    /brought to you by|sponsored by|a quick word from|who are supporting|patrocinado|use code|usa el codigo|percent off|por ciento de descuento|free trial|money back/i,
    0.93,
  ],
  [
    "self_promo",
    /patreon|subscribe|newsletter goes out|my (?:new )?course|hit subscribe|links are below|suscr/i,
    0.86,
  ],
  ["outro", /thanks for watching|see you next week|see you on friday|gracias por ver|hasta la proxima|in the description, and thanks/i, 0.9],
  ["recap", /to run all of that back|to run that back|to recap|so to summarise|so to summarize/i, 0.78],
  ["intro", /stay to the end|before any of that, a quick warning|five things happened|turned up this month|hoy probamos|i needed a shelf/i, 0.72],
];

export function fakeAnswer(text: string, hasMarkers: boolean): ChoiceAnswer {
  for (const [category, pattern, base] of RULES) {
    if (!pattern.test(text)) continue;
    const p = Math.min(0.97, base + (hasMarkers && category === "sponsor" ? 0.03 : 0));
    return spread(category, p);
  }
  return spread("content", hasMarkers ? 0.62 : 0.88);
}

function spread(top: Category, p: number): ChoiceAnswer {
  const rest = (1 - p) / (CATEGORIES.length - 1);
  const probabilities = Object.fromEntries(
    CATEGORIES.map((c) => [c, Number((c === top ? p : rest).toFixed(4))]),
  );
  return { type: "choice", choice: top, confidence: p, probabilities };
}

export interface FakeOptions {
  /** Question name to answer, overriding the heuristic. */
  answers?: Record<string, ChoiceAnswer>;
  port?: number;
  /** Status returned once, before any real answer. */
  failFirstWith?: number;
  /** Reject with a too-big 400 when a request carries more segments than this. */
  tooBigOver?: number;
}

export interface FakeServer {
  url: string;
  requests: JevRequest[];
  close(): Promise<void>;
}

export function startFakeJev(options: FakeOptions = {}): Promise<FakeServer> {
  const requests: JevRequest[] = [];
  let failed = false;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request = JSON.parse(body || "{}") as JevRequest;
      requests.push(request);
      const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      if (options.failFirstWith && !failed) {
        failed = true;
        send(options.failFirstWith, { error: "slow down" }, { "retry-after-ms": "1" });
        return;
      }
      const segments = request.state?.segments ?? [];
      if (options.tooBigOver && segments.length > options.tooBigOver) {
        send(400, { error: "state is too large for this model" });
        return;
      }
      const answers: Record<string, ChoiceAnswer> = {};
      let inputTokens = 0;
      for (const id of Object.keys(request.questions ?? {})) {
        const segment = segments.find((s) => s.id === id);
        inputTokens += Math.ceil((segment?.text.length ?? 0) / 4) + 200;
        answers[id] =
          options.answers?.[id] ??
          fakeAnswer(segment?.text ?? "", Boolean(segment?.has_promo_markers));
      }
      send(200, {
        model: request.model ?? "jev-1.13.0",
        answers,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1]?.endsWith("fake-jev.ts")) {
  const fixture = process.argv[2];
  const answers = fixture ? JSON.parse(readFileSync(fixture, "utf8")) : undefined;
  const port = Number(process.env.PORT ?? 4321);
  startFakeJev({ answers, port }).then((fake) =>
    console.log(`fake jev on ${fake.url} (set JEV_BASE_URL to it)`),
  );
}
