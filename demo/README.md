# The demo clip

## What it can honestly claim, today

There is no key and no gateway credit, so nothing in this clip is a live call. The answers
are real Jev output recorded on 2026-09-18 and replayed from `fixtures/answers/` by
`scripts/answer-server.mjs`. Everything else is real: real watch page, real captions read
in the tab, real segmentation, real probabilities, real skip.

That means one line has to appear in the post and in the README next to the GIF:

> Answers recorded 2026-09-18 and replayed; the request in the clip goes to localhost.

Do not claim "a video nobody has labeled" on this version. Every corpus video is
SponsorBlock-labeled, which is how it was scored in the first place. That claim needs a
TypeSafe key and a fresh upload, and it is the version worth waiting for if the key is
close.

## The scenario, four seconds

1. Watch page already playing, popup open beside it, bar empty. The viewer sees a normal
   YouTube video.
2. The popup's status line goes from `in flight` to `done in 0.9s`, and the segment count,
   the token estimate and the cost are visible while it does.
3. The seek bar fills: slices fade in across 1.4 seconds in `?jevdemo`, colored by category,
   opacity by probability. The bar tells the whole story of the video in one glance.
4. The cursor rests on a faint slice. The tooltip reads the category, the probability and
   the line of transcript behind it. This is the shot that separates it from SponsorBlock:
   you can see the doubt and the reason.
5. The playhead reaches a solid red slice. The video jumps. The toast reads
   `skipped 42s of sponsor (0.93) · undo`.

The hook is the internals, not the skip. Anyone can show a skip. Showing the probability
arriving, the cost in fractions of a cent, and a faint slice next to a confident one is the
thing nobody else can show.

## Before recording: does the caption fetch work at all

Unresolved and decisive, see `docs/browser-ground-truth.md`. An automated profile hits
YouTube's "Sign in to confirm you're not a bot" wall, which returns caption bodies of zero
bytes. Sign the recording profile in once:

    node scripts/login.mjs

It opens a window, waits while you sign in by hand, then reports whether that session gets
caption bytes and whether the caption URL carries a `pot=` token. Nothing is typed for you.
The cookies stay in `/tmp/jev-profile` for the recording runs.

If it reports bytes, the extension works for real users and the recording can proceed.
If it still reports zero, the caption path is broken for everyone and that is a v0.1
blocker, not a demo problem.

## Recording

    JEV_ALLOW_LOCALHOST=1 npm run build          # localhost endpoint, dev builds only
    node scripts/answer-server.mjs --port 4333   # leave it running
    node scripts/replay.mjs <videoId> --profile /tmp/jev-profile --video demo/raw

`--video` writes a Playwright capture of the page. Set the popup's endpoint to
`http://127.0.0.1:4333` once in the profile and it persists.

For a hand-held take instead: QuickTime, File > New Screen Recording, drag a box around the
player plus the popup, not the whole 5120x1440 display. Save as `demo/recording.mov`.

## Encoding

GIF for the README, two-pass palette so the flat UI colors stay clean:

    ffmpeg -i demo/recording.mov -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=none" -loop 0 demo/demo.gif

MP4 for X, which re-encodes GIFs to muted video anyway:

    ffmpeg -i demo/recording.mov -vcodec libx264 -pix_fmt yuv420p -crf 20 -an demo/demo.mp4

Keep the GIF under 5MB. If it lands over, drop to 640px width before touching the frame
rate.

Three stills to pull: a confident slice beside a faint one, the popup mid-request, the
toast.
