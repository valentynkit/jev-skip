# jev-skip

Browser extension: reads the YouTube caption track, one choice per 30 s segment, paints a
probability heatmap on the seek bar, skips above a threshold. Bring your own key. Read
`../CLAUDE.md` for the monorepo rules, then `CONTEXT.md` here in full.

Verdict after three review rounds: **ready to build**.

Project-specific rules:
- WXT + TypeScript, MV3, Chrome and Firefox from one build.
- The key lives only in `browser.storage.local`, read only by the background worker.
  Task 5's check greps the built content bundle for `apiKey` and must find nothing.
- Low confidence fails toward `content`: never skip on doubt.
- Caption fetch happens in the tab; an empty body means do nothing, no request.
- `npm run measure` runs offline against `fixtures/`; `npm run record` is the only command
  that needs a key.
