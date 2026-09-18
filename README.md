# jev-skip

Skips YouTube sponsors on videos nobody has labeled yet. Catches 77% of the sponsor seconds
SponsorBlock's crowd marked across 23 videos, at 27s of false skips per hour, for $0.0008 a
video, with the bar painted 0.9s after the request goes out.

    npm install && npm run build   # then load dist/chrome-mv3 unpacked, paste your key

[demo: the bar filling in while the video plays, then a skip firing]

Numbers from `npm run measure` over the fixtures in this repo, 2026-09-18, answered through a
Vercel AI Gateway shim rather than the direct API. Re-measure on `api.typesafe.ai` before
pinning anything to `jev-1.13.0`.

## Why

Every sponsor skipper on the market waits for a stranger to submit the timestamps.
SponsorBlock is excellent at that and it is always late: a video uploaded an hour ago has no
segments until someone watches it, notices the read, drags two handles and submits. For most
videos that never happens at all.

This one reads the caption track of the video you are already watching, sends the transcript
to Jev once, and gets back a probability per 30-second segment. The bar is painted before the
intro is over, on a video nobody has ever labeled. Slices are tinted by how sure the model is,
so a borderline sponsor is a ghost and a confident one is solid, and you can see the doubt
instead of guessing at it.

The honest limit lives here rather than only at the bottom: it reads text, not audio. No
captions, no opinion, and the extension does nothing at all. That is also the failure mode
when YouTube hands the page an empty caption response, which it does for some sessions, and
we cannot tell the two apart.

## Install

    git clone https://github.com/valentynkit/jev-skip && cd jev-skip
    npm install && npm run build

Chrome: `chrome://extensions`, developer mode, load unpacked, pick `dist/chrome-mv3`.
Firefox: `npm run build:firefox`, then `about:debugging`, load `dist/firefox-mv2/manifest.json`.
Open the popup and paste your TypeSafe key.

| variable | required | purpose |
|---|---|---|
| key in the popup | yes | your TypeSafe key, stored in the extension, sent only to the endpoint below |
| endpoint in the popup | no | defaults to `https://api.typesafe.ai`, point it at a local shim if you use one |
| `TYPESAFE_API_KEY` | no | only for `npm run record`, which rebuilds the fixture corpus |

## Privacy and permissions

Hosts: `youtube.com` to read the page you are on, `api.typesafe.ai` to ask the question.
What leaves your browser: the title, channel and caption text of the video you are watching,
under your own key. Nothing else, to nobody else. There is no server of ours, no account, no
telemetry, and no shared database. The key lives in extension storage that the page and the
content script cannot read; only the background worker touches it.

## How it works

1. The content script reads the caption track of the watch page. Empty means stop here.
2. Cues are deduped, then cut into 30-second windows snapped to sentence ends, capped at 45s.
3. A regex belt marks windows carrying a URL, a coupon-code shape or "use my link". Evidence
   code found, not a verdict.
4. The background worker sends the transcript once and one question per segment, then Jev
   answers all of them in a single request: `content, sponsor, intro, outro, self_promo,
   recap, other`.
5. Answers paint the seek bar as they arrive and arm one timer for the next segment over your
   threshold. Below it, on `other`, or on any error, nothing is skipped.

## Development

    npm test          # offline, against scripts/fake-jev.ts, no key and no network
    npm run measure   # the headline number over fixtures/, offline
    npm run record -- --dry-run   # re-select the 30-video corpus from SponsorBlock, write nothing
    npm run record -- --corpus    # fetch captions and crowd labels for the selection
    npm run record                # judge the corpus once and cache the answers, needs a key

`measure` writes `measure.json` next to the four lines: per-video rows, the threshold sweep,
the reliability bins, the pessimistic intersection-over-union figure, and the non-English
videos it kept out of the headline. `thresholds.json` turns the recall floor and the
false-skip ceiling into exit codes.

## Known limits

- No captions, no opinion. It reads text, not audio.
- The caption check can also come up empty on a video that does have captions: YouTube serves
  an empty response to some session and client combinations, and PoToken gating is making that
  more common. We cannot tell that apart from a caption-less video, so both end the same way,
  with the extension doing nothing.
- Sponsor versus the creator's own plug is fuzzy, and the crowd disagrees with itself there.
- Unsure segments are painted faint and never skipped. It under-skips on purpose.
- Non-English captions are weaker and are reported separately, never in the headline.

## License

MIT.
