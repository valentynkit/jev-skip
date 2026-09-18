# Changelog

All notable changes to this project are documented here, following Keep a Changelog.

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
