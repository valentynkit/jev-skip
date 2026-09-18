# jev-skip CONTEXT.md — round 2 review

## Resolution table (REVIEW-1 findings)

1. IoU-as-headline — **Resolved.** Recall is now headline, false-skip/hour the paired guard,
   IoU demoted to a `measure.json` detail line labeled pessimistic (section 5).
2. Cost math / hook line mismatch — **Resolved.** Hook line drops the fraction claim; section
   4's napkin math now uses matched numbers (20-min video, 40 segments, ~12k tokens), "not a
   claim."
3. Untested `has_promo_markers` false-positive — **Resolved.** Risk 4 plus a named fixture in
   section 5's failure-mode list, with an explicit "field comes out" fallback if it fails.
4. Caption claim sourced from blogs, failure mode undersold — **Resolved.** Section 3 names
   the inference and blog source; README's Known limits now covers the false-negative case on
   a video that does have captions.
5. Citation off by two lines — **Resolved.** `entrypoints/background.ts:60-62`.
6. self_promo ground truth unspecified — **Resolved.** `categories=[...]` named, with the
   `preview`→`recap` mapping and the three not requested.

## New findings

**1. BLOCKER — false-skip guard's data source is unspecified.** Section 5 gates on "videos
with three or more independent submissions." The only ground-truth fetch specified is the
live `skipSegments` API, whose schema per `docs/research/03:41` (cited elsewhere in this doc as
verified) is `{segment, category, UUID}` — no vote/submission count. The real API does return
a `votes` field, but it's a net score, not a submission count, and the doc never says to
capture it, store it in `crowd/<id>.json`, or how it maps to "independent submissions" (per
video? per segment? summed across categories?). Tasks 5 and 8 both depend on this number and
neither states where it comes from — a builder guesses at task 5. Since "both gates ship
together or neither means anything," an unspecified guard undermines the headline too.

**2. CONCERN — task 8's check doesn't exercise the exit-gate logic.** Section 5: "`measure`
exits 1 if recall drops below the locked floor or false-skip rises above its ceiling." Task
8's check only asserts the four lines print, `measure.json` writes, and a missing fixture
exits non-zero — none of it touches the thresholds. A tool that always reports 0% recall
would pass. Also unstated: pre-`jevcal --lock` behavior (no floor/ceiling exists yet) — does
first-run `measure` always exit 0? Add a fixture engineered to fail each gate and assert on
exit code; state the pre-lock case.

**3. CONCERN — "above-floor segment" (task 6) is undefined against section 3's own rule.**
Section 3 says "one hue per category" at `opacity = clamp(p, 0.12, 0.85)`, a continuous
function excluding no category — including `content`/`other`. Task 6's check asks for "one
`<li>` per above-floor segment," but no floor is named: not the 0.12 clamp, not the 0.30
dead-band edge, not a content/other exclusion. Painting every segment (including ordinary
`content`) tints most of the bar continuously — noise, not a heatmap — but section 3 doesn't
rule that out. The builder has to invent the rule, not read it.

## Verdict

**NOT YET** — pin down where the "independent submissions" count for the false-skip guard
comes from (finding 1) before starting task 5; findings 2-3 can be resolved inline during
their own tasks.
