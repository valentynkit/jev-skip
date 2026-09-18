# jev-skip

Browser extension: reads the YouTube caption track, one choice per 30 s segment, paints a
probability heatmap on the seek bar, skips above a threshold. Bring your own key. Read
`../CLAUDE.md` for the monorepo rules, then `CONTEXT.md` here in full.

Verdict after three review rounds: **ready to build**.

## Build state (2026-09-18, first build session)

Tasks 1 to 10 coded. `npm test` 36 tests in 7 files, all passing, offline. Both builds
emit (`dist/chrome-mv3/`, `dist/firefox-mv2/`) and both zips exist. The content bundle
contains no `apiKey` or `Bearer`. Loading unpacked in a browser has NOT been done; nothing
has been watched on a real YouTube page yet. No second-pair review; that is
`sessions/01-review.md`.

This is the one project with real numbers. `npm run measure`, offline over recorded
fixtures, prints:

```
77.0% of crowd-labeled sponsor seconds caught (n=23 videos / 1,820 labeled seconds, recorded fixtures, typesafe-ai/jev)
27.2s false-skip per hour, upper bound (n=22 dense-subset videos)
$0.0008 per video (n=23, mean 18.1k input tokens)
0.9s p50 to first painted segment (n=23, single request)
```

Brier 0.117, IoU 0.666, sweep in `measure.json`. The `has_promo_markers` arm was answered
with data on the 12 videos both arms cover: 79.0% recall with the belt versus 73.4%
without, at the same false-skip rate. Main arm recorded 27 of 27 chunks; the `--no-markers`
arm 12 of 27 (gateway rate limit), resumable at zero cost for what exists. All of it came
through the Vercel AI Gateway shim (`model: typesafe-ai/jev`); re-measure on the direct API
before pinning `jev-1.13.0`. `thresholds.json` is a regression guard, not a published
threshold.

CONTEXT.md changes made by the build (in the file): selection walks SponsorBlock's
k-anonymity hash prefixes ascending instead of the multi-GB CSV dump; captions come from
`yt-dlp` (timedtext is session-signed) and are minified to three fields; the corpus is 23
real videos, not 30 (seven have no readable English track); the popup has a configurable
endpoint; Firefox builds MV2 because Firefox MV3 makes host permissions opt-in; three
answer directories (recorded, no-markers, fake) and `measure` names which it scored; the
live-trace popup and the "why" tooltip are v0.1; open questions replaced by the answers
(auto-skip on at 0.85, belt shipped as state, Chrome demo).

Three `ponytail:` markers: the watch page is re-fetched and scraped for the player response
(`entrypoints/youtube.content.ts:69`); one skip threshold for all five categories
(`lib/schedule.ts:39`); the fake's keyword heuristic (`scripts/fake-jev.ts:5`).

Blocked on: the remaining 15 no-markers chunks (gateway credits), a manual load in Chrome
and Firefox, and a direct-API re-measure when a TypeSafe key exists.

## Next sessions

`sessions/01-review.md` (brutal review, a real browser, fixes, README, hygiene, store
listing) then `sessions/02-demo.md` (the screen recording of the bar filling and a skip
firing, the X thread). Each in its own session.

Review targets: the extension has never run on a real watch page (player-response scrape,
SPA navigation, the `.ytp-progress-bar` container, ads shifting `currentTime`, live
streams, Shorts, embedded players, playlists); the popup's live trace across
`storage.session` on Firefox MV2; key isolation under a compromised content script; the
skip timer versus YouTube's own ad skips and chapter seeks; the 45 s cap and sentence
snapping on auto-captions with no punctuation; token estimate versus real usage; the
selection rule's reproducibility from a clean machine.

Project-specific rules:
- WXT + TypeScript, MV3, Chrome and Firefox from one build.
- The key lives only in `browser.storage.local`, read only by the background worker.
  Task 5's check greps the built content bundle for `apiKey` and must find nothing.
- Low confidence fails toward `content`: never skip on doubt.
- Caption fetch happens in the tab; an empty body means do nothing, no request.
- `npm run measure` runs offline against `fixtures/`; `npm run record` is the only command
  that needs a key.
