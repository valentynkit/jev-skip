# jev-skip CONTEXT.md — adversarial review

## Ranked findings

**1. BLOCKER — Section 5, headline metric contradicts its own honesty argument.**
"What agreement means, honestly" states the rule correctly: crowd coverage is sparse, so
"we said sponsor, crowd said nothing" must never score as a loss. Two sentences later the doc names a plain
second-level IoU over sponsor-like categories as the *headline*. IoU's union term punishes
exactly the case the paragraph above just ruled out: a correctly-caught sponsor read that
the crowd hasn't reached consensus on (common — many "locked" videos still have a second,
unlabeled sponsor break) inflates the union without inflating the intersection, dragging
the number down for being *right on an unlabeled segment*. That penalizes the tool's own pitch ("decides on a video nobody has
ever labeled"). False-skip-seconds already solves this by gating on submission density;
IoU as written doesn't.
Fix: make Recall the headline "agreement" number (SHARED's table only requires "agreement,"
not IoU specifically), keep False-skip-seconds as the secondary honesty check, drop IoU or
demote it to `measure.json` detail.

**2. CONCERN — Sections 1 and 4, cost math doesn't reconcile with the hook line.**
The hook line commits to "a twentieth of a cent" (~$0.0005/video). Section 4's own napkin
math — a 20-minute video at ~4k transcript tokens plus sixty 200-token criteria copies
(~12k) — is ~16k tokens, which at $0.042/M is ~$0.00067, about 30% over the claimed
fraction. The "sixty" segment count is also lifted from docs/research/02's 30-minute-video
example, not paired correctly with the 20-minute transcript-token figure it sits next to.
Fix: use matched numbers (a 20-min video is ~40 segments at 30s each, not 60) and don't
commit to a specific fraction in the hook line before `measure` produces the real one —
that's the whole point of SHARED's "number is measured, not guessed" rule applied to cost
too.

**3. CONCERN — Section 5, missing test for the doc's own new risk surface.**
docs/research/01 §6 lists "contradictory instructions vs. criteria" as a jaggedness axis. The
doc adds `has_promo_markers`, a regex-computed boolean fed into state as evidence — a field
that doesn't exist in docs/research/02's original design, and Open Question 2 already flags it
as possibly muddying the headline. No fixture tests the case where that signal is wrong: a
coupon-shaped string in a giveaway announcement or a URL in an on-screen credit, not an
actual sponsor read. This is the one jaggedness risk the design itself introduces, and it's
the one left untested. Fix: one fixture with a false-positive `has_promo_markers: true` on
a non-sponsor segment, asserting the label doesn't flip.

**4. CONCERN — Section 3, caption acquisition sourced from blogs, and the failure mode
undersold.** The "session-signed, empty 200 from any other context" claim traces to two
blog posts (grokipedia, nadimtuhin), not YouTube documentation — reasonable, since none
exists, but worth naming as inference rather than fact. Current public reports of PoToken /
`exp=xpe` gating on the WEB client (2025-2026) suggest YouTube's empty-200 response can
also hit same-tab, same-session fetches some of the time, not only cross-context ones. The
doc's fallback ("no caption track… nothing to read") already degrades safely, which is the
right call — but the README's "Known limits" should say the check can false-negative on a
video that does have captions, not only "no captions on this video."

**5. NIT — Section 3, citation is two lines off.** `entrypoints/background.ts:58-59`
(inherited from docs/research/03) points at the comment describing the `storage.setAccessLevel`
call; the call itself is lines 60-62 in the clone. Cosmetic, but worth fixing when this
becomes a real code comment so the next reader isn't sent to prose instead of code.

**6. NIT — Section 5, self_promo ground truth is unspecified.** Corpus selection filters
the SponsorBlock CSV by `category=sponsor` only; the IoU/recall math later unions sponsor +
self_promo. Whether the live `skipSegments` query's `categories=[...]` parameter actually
includes `selfpromo` isn't stated, so self_promo recall may rest on no ground truth for
videos selected purely on the sponsor column. One line naming the categories list queried
would close this.

## Verified against source

- `src/js-components/previewBar.ts:409-443` (SponsorBlock clone) — confirmed: absolutely
  positioned `<li>`, `left`/`right` as percentages, opacity via CSS variable. Doc's
  description and adaptation to continuous opacity is accurate.
- `src/utils/segmentData.ts:57-71` — confirmed: `GET /api/skipSegments/<sha256(videoID)
  first-5-hex>?categories=...`, filtered client-side by `video.videoID === videoID`. Doc's
  citation and description match exactly.
- `src/content.ts:830` — confirmed: `isFirefoxOrSafari() && !isSafari() ? 600 : 150`. Doc's
  "150ms Chrome, 600ms Firefox" is exact, including the line number.
- Caption `baseUrl` session-signing: doc's claim matches current public reporting, but the
  sourcing is two blogs, not primary docs, and the gating appears to be tightening (see
  finding 4) — flagged, not disproven.

## Keep as is

- File layout (six single-purpose `lib/` modules, no framework, no DI container) is the
  smallest thing that earns the star; tried to find an abstraction being built ahead of a
  second use case and didn't.
- The fail-safe direction is airtight: error, below-threshold, and `other` all resolve to
  "content" (no skip), stated once in the question-design section and enforced nowhere else
  needing restatement.
- The two regex belts match SHARED's rule precisely (code owns sentence boundaries; the
  promo-marker belt feeds evidence, never a decision), and the doc interrogates its own
  choice to keep the promo-marker belt (Open Question 2) rather than assuming it belongs.
- No hype words, no em dashes, no emoji — reads human, matches SHARED's voice bar.
