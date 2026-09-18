# Session prompt: brutal review, a real browser, and the README

Run from inside `jev-skip/` in a fresh Claude Code session.

## Context to load first

1. `../CLAUDE.md` (monorepo rules, real Jev access), then `CLAUDE.md` here ("Build state").
2. `CONTEXT.md` in full including the review responses; `REVIEW-3.md`; `../SHARED.md`.
3. `../research/04-quality-bar-and-launch.md` sections 1, 2, 4; `../research/01` section 6;
   `../research/00c-feasibility.md` section A; `../research/03` section 3.
4. Prior art at `/tmp/prior-art/` (re-clone per `../CLAUDE.md` if gone): ajayyy_SponsorBlock
   (`src/js-components/previewBar.ts`, `src/content.ts`, `src/utils/segmentData.ts`),
   kitze_unclutter (`entrypoints/background.ts`, the key split), leepokai_jev-guard.

## State on entry

One build session, no review, never loaded in a browser. 36 tests pass. Real measured
numbers exist (77.0% recall, 27.2 s/h false-skip upper bound, $0.0008 per video) through
the gateway shim, on 23 videos. Both zips build.

## The job

Parallel subagents, at most 5 in flight, drafting on opus, reviewers on sonnet, never
`model: inherit`.

1. **Load it for real, first.** Chrome unpacked from `dist/chrome-mv3/`, Firefox temporary
   add-on from `dist/firefox-mv2/`. Paste the shim endpoint and any key. Open five watch
   pages of different shapes (long lecture, 8-minute vlog with a sponsor, a live stream, a
   Short, a playlist item), navigate between them without reload, seek, change speed, let
   an ad play. Record every failure with a screenshot in `/tmp`. This is the review's
   ground truth; do it before reading code for bugs.
2. **Brutal review.** One reviewer each for: `youtube.content.ts` (player-response scrape,
   SPA navigation, teardown, ad interference, the tooltip, the toast); `background.ts` and
   `lib/jev.ts` (key isolation, retry, bisect, endpoint validation, `storage.session` on
   MV2); `lib/captions.ts` and `lib/segment.ts` against real auto-captions with no
   punctuation, non-English tracks, music videos; `lib/bar.ts` positioning on the mini
   player and theater mode; `lib/schedule.ts` timer races; `scripts/record.ts` and
   `scripts/measure.ts` (selection reproducibility, the dense-subset rule, the sweep math,
   Brier); the popup's live trace. Each finding: file:line, failure scenario, severity,
   fix, verified.
3. **Fix what is real**, tests first, every error path resolving to content.
4. **Finish the measurement.** Record the remaining no-markers chunks when credits exist;
   publish both arms. Re-measure on the direct API when a TypeSafe key exists, then pin
   `jev-1.13.0` and lock `thresholds.json` as a published threshold.
5. **The README, state of the art.** `research/04` section 1 order: the measured line
   first with its footnote, the install command and the unpacked load steps, the GIF above
   the fold, Why (crowd databases are always late; the no-captions limit folded in),
   Privacy and permissions as a table (what leaves the browser, to whom, under whose key),
   Cost, How it works (the five-step pipeline), Accuracy (all four measure lines, both
   arms, the selection rule so anyone can rebuild the corpus, IoU as the pessimistic
   detail), Known limits, Development, License. Human voice, no em dashes, no hype, no
   emoji. Name SponsorBlock with respect; "different approach, not a replacement".
6. **Hygiene and the stores.** MIT `LICENSE` (exists), `CONTRIBUTING.md` (tests, the fake,
   how to add a corpus video, how to record), `CHANGELOG.md` in Keep a Changelog form,
   `.env.example`, a GitHub Actions workflow running `npm test` and `npm run build` and
   `npm run measure` offline. Draft the Chrome Web Store listing (name, summary, the
   permission justifications, privacy policy text: no server, no telemetry) and the
   Firefox self-distribution steps for a signed xpi in `docs/store.md`.
7. **Close.** Runnable check and pasted output per task; `CLAUDE.md` and CONTEXT.md updated
   in the same commit as any decision change; local commits only.

## Non-negotiables

The key never reaches the content script. Doubt resolves to content, never a skip. No
server of ours, no telemetry. Numbers come from `npm run measure` or stay `__`.
