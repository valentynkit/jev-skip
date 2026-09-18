# jev-skip CONTEXT.md — round 3 review

## 1. REVIEW-2 items — verified fixed in body

- **Guard source**: fixed. Section 5 (184-193) names
  `GET .../api/searchSegments?videoID=<id>&categories=[...]&actionTypes=["skip"]` returning
  `votes, views, locked, timeSubmitted, userID`. Confirmed against the live endpoint today:
  it returns exactly `UUID, timeSubmitted, startTime, endTime, category, actionType, votes,
  views, locked, hidden, shadowHidden, userID, description` per segment — matches the claim,
  including the hashed `userID`.
- **Exit gates**: fixed. Task 8 (282-286) runs the four cases from the resolution table:
  pass, recall-floor fail, false-skip-ceiling fail, pre-lock exit 0.
- **Paint rule**: fixed. Section 3's rule ("neither content nor other," floor 0.20, 88-91)
  now matches task 6's check (275-277) verbatim — the earlier 0.12/0.20 mismatch is gone.

## 2. Section 5 measure cases vs thresholds.json / README

Consistent. "exits 1 if recall drops below the locked floor or false-skip rises above its
ceiling" (236-237) plus "until thresholds.json exists ... exits 0" (238-239) map 1:1 onto
task 8's four cases. README headline (296-298) pulls the first three of the four measure
lines (drops time-to-first-coverage) — a subset, not a contradiction.

## 3. Implementation tasks read as a builder

- **Task 2** ("rolling-duplicate dedup") never states the dedup rule. Auto-captions emit
  overlapping rolling-window text; the overlap-detection logic is left for the builder to
  invent.
- **No task builds `scripts/record.ts` or `scripts/fake-jev.ts`.** Both are named
  deliverables (layout line 250; section 5, 194-202 and 236) that measure's fixtures depend
  on, but neither has a numbered task or check. A builder reaches task 8 with no committed
  `crowd/*.json` or `jev/*.json` and no instructions for producing them.

## Verdict

**NOT YET** — add a task with a runnable check for corpus curation / `record.ts` before
task 8; measure's fixtures don't exist without it.
