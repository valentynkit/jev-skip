# Browser ground truth, 2026-09-19

First session that ran the built extension in a real browser. Everything below is measured,
not reasoned. It replaces the "never loaded in a browser" line in CLAUDE.md.

## What was used

No Chrome and no Firefox exist on this machine (only Arc, Safari, and Playwright's bundled
Chrome for Testing 153). `sessions/01-review.md` step 1 says "Chrome unpacked"; that step ran
against Playwright's Chromium instead, driven by two harnesses added here:

- `scripts/drive.mjs` loads `dist/chrome-mv3/` into a headed Chromium, pastes key and
  endpoint through the real popup, opens a watch page, prints the trace plus console and
  network failures.
- `scripts/probe.mjs` runs the three caption steps one at a time in the page, per video, per
  caption format.
- `scripts/replay.mjs` paints a trace rebuilt from `fixtures/` onto a real watch page and
  drives a skip, so the visual layer can be exercised with no key and no live captions.

## 1. BLOCKER: the caption fetch returns 200 with an empty body

Every video, every format, manual tracks as well as ASR:

    dQw4w9WgXcQ  tracks: en, en:asr, de-DE, ja, pt-BR, es-419
    json3 / srv3 / vtt / no fmt  ->  status 200, length 0
    4RcThoRG46c  en:asr         ->  status 200, length 0
    2wuUSEFjr50  en:asr         ->  status 200, length 0

Everything before the fetch works: the watch page re-fetch returns 200, the
`ytInitialPlayerResponse` regex matches, the JSON parses, `captionTracks` is populated and
`pickCaptionTrack` picks the right one. Only the body is empty.

`baseUrl` carries no `pot=` parameter in any of the three videos. YouTube answers a
pot-less timedtext request with 200 and zero bytes. The same session gets intermittent 403s
on `videoplayback`, so this profile is failing BotGuard generally.

### The cause, found later in the session

A screenshot of the player taken during a later run shows YouTube's bot wall in place of the
video: **"Sign in to confirm you're not a bot"**. That one wall explains all three symptoms
at once, the empty caption bodies, the 403s on `videoplayback` and `readyState 0`. So the
empty body is most likely what a blocked session gets, not what every session gets. It does
not clear the extension: it means this machine cannot answer the question without a
logged-in profile.

Unresolved: whether a real logged-in browser gets `pot=`-bearing caption URLs. That single
fact decides whether v0.1 works at all or needs a page-world token grab
(`entrypoints/youtube.content.ts:69` already carries the `ponytail:` marker whose ceiling
this is). Console check to run in a normal browser on a watch page:

    (async () => {
      const t = ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const track = t.find(x => x.languageCode?.startsWith('en')) ?? t[0];
      const r = await fetch(track.baseUrl + '&fmt=json3');
      const b = await r.text();
      console.log({ hasPot: track.baseUrl.includes('pot='), status: r.status, bytes: b.length });
    })()

Note the extension's behaviour here is correct by design: no captions means no bar and no
request. The README already says an empty body and a caption-less video are
indistinguishable. What the README does not say is that the empty body may be the normal
case rather than the exception.

## 2. The "why" tooltip cannot be hovered

With a trace replayed onto a real watch page the bar mounts and paints (3 painted slices out
of 54 sent, correct: only the five skippable categories are painted). Hovering a slice never
fires `mouseenter`:

    topElementAtSlice: div.ytp-timed-markers-container

`lib/bar.ts:19` appends the slice list inside `.ytp-progress-bar` at `z-index:1`, under
YouTube's own markers container, which swallows the pointer. The tooltip is half the pitch
("you can see the doubt instead of guessing at it") and today it is unreachable on any real
page.

## 3. Playback in an automated profile is not reliable

Two runs of the same command, same video, minutes apart:

    run 3: readyState 4, duration 1634.681, blob src, no error
    run 5: readyState 0, duration null, src "", player never initialised

Plus `ERR_NAME_NOT_RESOLVED` on doubleclick hosts and intermittent 403 on `videoplayback`.
Consequence for `sessions/02-demo.md`: an automated Playwright capture cannot be trusted to
produce a take with the video actually playing. The clip needs a real browser session.

## 4. Harness gotchas worth keeping

- `page.evaluate` must not `await video.play()`: the promise can stay pending through a seek
  and the evaluate never returns. Two runs hung for minutes on exactly this.
- `.ytp-progress-bar` is attached but hidden while the controls are faded; wait for
  `state: "attached"`, then move the mouse over the player.
- Playwright's version must match the browser build in `~/Library/Caches/ms-playwright`
  (1.63 wants chromium-1243).

## Jev access, 2026-09-19

The gateway shim answers with:

    Free tier requests on this model are rate-limited. Upgrade to paid credits at ...

Vercel's minimum top-up is $20, which the user declined, so no live answers exist for this
project until a TypeSafe key does. Everything measurable from here on runs against
`fixtures/answers/` (real Jev, recorded 2026-09-18 through the shim) or the fake. Any clip
produced this way is a replay and has to be labelled one.

## What this means for the demo

The session-02 plan assumed a live request on an unlabeled video in Chrome. Three of its
preconditions are gone: no live key, no reliable automated playback, and captions that come
back empty in every session tested so far. The demo is blocked on finding 1 above.
