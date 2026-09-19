# Changelog

All notable changes to this project are documented here, following Keep a Changelog.

## Unreleased

### Fixed
- Captions could never be read at all: a timedtext URL without a proof-of-origin token is
  answered with 200 and an empty body. A page-world hook keeps the URL the player signs for
  itself and re-asks for it as json3. Installed as a MAIN-world content script on Chrome,
  because injecting a `<script src>` lost the race against the player about a third of the
  time. Measured after the change: 29 of 30 cold loads paint, median 2.9s.
- Seeking back into a skipped segment re-skipped it instantly, so undo did nothing.
- A throttled background-tab timer could seek the playhead backwards by minutes.
- Skips could fire against an ad's clock, cutting the ad instead of the sponsor.
- A trace from another tab could arm a skip against the video you were watching.
- The heatmap was painted under YouTube's own progress layers at `z-index: 1`, where the
  markers container also swallowed every hover, so the tooltip never opened.
- Probability was drawn as transparency, which let the video through; it is colour strength
  against a fixed base now.
- The tooltip wrapped into an unreadable column at the ends of the bar, and sat behind
  YouTube's seek preview.
- The toast was positioned against the window rather than the player.
- 'z' undid a skip while typing a comment, and Cmd-Z did too.
- A settings message from a content script could point the endpoint, and the key, anywhere.
- The false-skip figure scored two of the five categories the extension skips: 27.2s/h
  becomes 34.0s/h. The Brier score used one minus the top choice as the sponsor
  probability: 0.117 becomes 0.105.
- The corpus walk covered a sixteenth of the hash space it documents.

### Added
- `demo/demo.mp4` and `demo/demo.gif`: one take of the bar filling, the skip firing and the
  popup showing the request, with the answers replayed from the recorded fixtures.
- Harnesses that drive a real browser over CDP: `scripts/record-demo.mjs`,
  `scripts/reliability.mjs`, `scripts/cdp.mjs`, `scripts/answer-server.mjs`, and the
  diagnostics behind the caption finding.
- `docs/browser-ground-truth.md` and `docs/review-01.md`.

## [0.1.0] - 2026-09-18

### Added
- Caption reader for YouTube watch pages: player response, track selection, json3 parse,
  rolling-duplicate dedup for auto-captions.
- Segmenter: 30-second windows snapped to sentence ends, 45-second cap, regex belt for
  promo markers.
- One Jev request per video, chunked at 90 segments or 20k state tokens, one choice question
  per segment.
- Background client with a single timeout budget across retries, backoff on 429 and 5xx, and
  split-and-retry on a too-big 400. The key never reaches the content script.
- Probability heatmap on the seek bar, with a hover tooltip naming the category, the
  probability, the start time and the text behind the slice.
- One armed skip timer, re-armed on seek, rate change, duration change, play and pause, with
  an undo toast.
- Popup showing the live trace of the current video's request: segments, estimated tokens and
  cost, request status, a mini timeline that fills as answers arrive, a category legend, the
  threshold slider and the auto-skip toggle.
- First measurement: 77% of crowd-labeled sponsor seconds caught across 23 videos, 27s of
  false skips per hour, $0.0008 a video, 0.9s to the first painted segment. Answered through
  a gateway shim, not the direct API.
- `npm run record` to rebuild the corpus and record answers, `npm run measure` to print the
  headline number offline, `scripts/fake-jev.ts` for tests without a key.
