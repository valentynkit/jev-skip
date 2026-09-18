# jev-skip CONTEXT.md — round 3 review

## 1. REVIEW-2 items — verified fixed in body

- **Guard source**: fixed. Section 5 (lines 184-193) names
  `GET .../api/searchSegments?videoID=<id>&categories=[...]&actionTypes=["skip"]` returning
  `votes, views, locked, timeSubmitted, userID`. Confirmed live today: calling that exact
  endpoint returns `UUID, timeSubmitted, startTime, endTime, category, actionType, votes,
  views, locked, hidden, shadowHidden, userID, description` per segment — matches the doc's
  claimed fields exactly, including the hashed `userID`.
- **Exit gates**: fixed. Task 8 (lines 282-286) runs the four cases named in the resolution
  table: pass, recall-floor fail, false-skip-ceiling fail, pre-lock exit 0.
- **Paint rule**: fixed. Section 3's rule ("neither content nor other," floor 0.20, lines
  88-91) now matches task 6's check ("non-content, non-other, p >= 0.20," lines 275-277)
  verbatim — the earlier 0.12/0.20 mismatch is gone.

## 2. Section 5 measure cases vs thresholds.json / README

Consistent. "exits 1 if recall drops below the locked floor or false-skip rises above its
ceiling" (236-237) plus "until thresholds.json exists ... exits 0" (238-239) map 1:1 onto
task 8's four cases. README headline (296-298) pulls the first three of the four measure
lines (drops time-to-first-coverage) — no contradiction, just a subset.

## 3. Implementation tasks read as a builder

- **Task 2** ("rolling-duplicate dedup") never states the dedup rule. Auto-captions emit
  overlapping rolling-window text; detecting the overlap to strip is left to the builder to
  invent.
- **No task builds `scripts/record.ts` or `scripts/fake-jev.ts`.** Both are named
  deliverables (file layout line 250; section 5 lines 194-202 and 236) that the measure
  fixtures depend on, but no numbered task has a check for either. A builder reaches task 8
  with no committed `crowd/*.json` or `jev/*.json` and no instructions for producing them.

## Verdict

**NOT YET** — add a task (with a runnable check) for corpus curation / `record.ts` before
task 8, since `measure`'s fixtures don't exist without it.
