# Review 01, 2026-09-19

Five reviewers over the whole codebase, plus the first real browser run
(`docs/browser-ground-truth.md`). Everything below was checked against the code; a few of
the reported blockers did not survive that check and are listed as rejected with the
evidence.

## Fixed

| What | Where | Was |
| --- | --- | --- |
| Slices painted under YouTube's own progress layers, tooltip unhoverable | `lib/bar.ts` | `z-index: 1`, below markers at 40. Now 42, measured against the live DOM. |
| A tooltip left open forever when its slice was rebuilt | `lib/bar.ts` | `update()` wiped every `li` without hiding the tip. Hidden first now. |
| Live streams painted invisible zero-width slices | `lib/bar.ts` | `Infinity > 0` passed the duration guard. Finite check added. |
| Seeking back into a skipped segment instantly re-skipped it, defeating undo | `lib/schedule.ts` | No memory of what had fired. A fired id is never armed again. |
| A throttled background-tab timer rewound playback by minutes | `lib/schedule.ts` | `fire()` seeked unconditionally. It now drops a timer that lands past the segment. |
| An armed skip could fire against an ad's clock and cut the ad | `lib/schedule.ts`, `entrypoints/youtube.content.ts` | No ad awareness at all. `arm()` stands down while `.ad-showing` is on the player. |
| Another tab's trace armed a skip against this tab's video | `entrypoints/youtube.content.ts` | The worker broadcasts; the listener took any trace. It now drops traces for other video ids. |
| Undo across a navigation seeked the new video to the old one's timestamp | `entrypoints/youtube.content.ts` | `lastSkip` survived teardown. Cleared now. |
| Cmd-Z while typing a comment rewound the video | `entrypoints/youtube.content.ts` | No modifier or focus check on the 'z' handler. Both added. |
| A settings message could point the endpoint, and the key, at any origin | `entrypoints/background.ts` | `set-settings` took any sender and stored `patch` unvalidated. Content-script senders are refused, `baseUrl` must be https (or localhost), threshold is clamped. |
| The false-skip number covered two of the five categories the extension skips | `scripts/measure.ts` | Scored sponsor and self_promo only while `lib/schedule.ts` skips all five painted ones. **27.2s/h became 34.0s/h.** |
| Brier and the reliability bins scored an invented probability | `scripts/measure.ts` | Used `1 - p(top choice)` as the sponsor mass, so a segment answered `intro 0.58` counted as 0.42 sponsor when the real answer was 0. Reads the distribution now. **Brier 0.117 became 0.105.** |
| The corpus walk covered a sixteenth of the hash space it documents | `scripts/record.ts` | `n < 4096` over a 4-hex prefix. Now `65536`. Today's corpus is unaffected; a thinner slice would have silently returned a short corpus. |
| The popup offered an endpoint the manifest forbade | `wxt.config.ts` | Localhost is a build flag now (`JEV_ALLOW_LOCALHOST=1`), off in anything published. |

Published numbers changed as a result. README, CLAUDE.md, `thresholds.json` and
`docs/store.md` all carry 34.0s/h now. Recall, cost and first-paint are untouched.

## Rejected

**"`storage.local.setAccessLevel` is a no-op, so any content script can read the key."**
Tested rather than argued, in Chromium 153 with the real extension loaded
(`scripts/keycheck.mjs`): `chrome.storage.local.setAccessLevel` is a function, the call
resolves, and a probe placed inside our own content script got

    threw: Access to storage is not allowed from this context.

So the isolation holds on Chrome. The reviewer was reading documentation that predates
Chrome extending access levels beyond `storage.session`.

The honest remainder: Firefox has no such API, so on Firefox a compromised content script
can read `storage.local`, key included. Nothing in the repo said so before. It is now a
known limit rather than a claim of protection.

## Deferred, and why

The recorded answers in `fixtures/answers/` are keyed by a sha256 of the request, so any
change to segmentation or to `has_promo_markers` changes every hash and orphans all 27
recorded chunks. There is no budget to re-record (Vercel's minimum top-up is $20, declined;
no TypeSafe key yet). These are real and stay unfixed until a key exists:

- **`lib/segment.ts:40`**: `time: Math.min(cue.end, next.start)` assumes cues do not
  overlap, but 83.3% of consecutive cue pairs in the real corpus do. A sentence-ending
  boundary gets reported earlier than it is and falls outside the 8s snap window. Measured
  consequence: only 36.9% of boundaries land on a sentence end or a silence, against a
  design that describes sentence snapping as the main defence; 14 of 230 boundaries violate
  the segmenter's own stated invariant.
- **`lib/segment.ts:17`**: `CODE_MARKER` requires uppercase, and every real caption track in
  the corpus is lowercase ASR, so it has never fired on real data. Two genuine coupon reads
  in the corpus go unmarked.
- **`lib/captions.ts`**: `dedupeRollingCues` touched 4 cues out of 10,024. The rolling
  duplication it was written for barely exists in yt-dlp's json3; the real overlap is in
  timestamps, which it does not address.
- Intra-video caption silences leave 789.6s across 27 videos in no segment at all (worst
  case 236s, 19% of one video). Not a bug, but a second flavour of "unpainted" that only
  the README's caption-less case currently covers.

Also deferred: per-tab `inFlight` (one controller aborts every tab's judge), partial-chunk
failure being reported as `done` in the popup, split-and-retry discarding a successful half
when its sibling fails, and diffing the bar instead of rebuilding it. All real, none of them
changes what gets skipped.
