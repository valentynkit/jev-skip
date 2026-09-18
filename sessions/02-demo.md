# Session prompt: the screen recording and the X post

Run after `sessions/01-review.md`, from inside `jev-skip/`.

## Context to load first

`../CLAUDE.md`, `CLAUDE.md`, `CONTEXT.md` sections 1, 7, 8, `../SHARED.md` "The recipe"
and "Launch", `../research/00a-virality-recipe.md`, `../research/04` section 2 (QuickTime,
the ffmpeg palette command, X specs), `demo/README.md`, `entrypoints/popup/`,
`lib/bar.ts`, `youtube.content.ts` (tooltip and toast).

## What the clip must do

Muted, phone width, four seconds. A YouTube video nobody has labeled starts, the popup is
open beside it, the popup's request line goes from "in flight" to "done in 0.9 s", the
mini timeline and the seek bar fill with colored slices at once, the playhead reaches a
solid red slice, the video jumps, the toast says "skipped 42s of sponsor (0.93) · undo".
The internals are the hook: the viewer sees the request go out, the token count and the
cost, the probabilities arriving, and the doubt (a faint slice) next to the certainty.

## The job

1. **Design the frame.** Storyboard a 16:9 capture (browser window cropped, popup pinned
   open beside the player; consider a detached popup window or a second tab rendering the
   popup so both are visible) and a square X crop. Decide the seven category hues (one hue
   per category, opacity from probability, readable on YouTube's dark progress bar and on a
   phone), the popup typography (tabular numbers, one accent), the toast's position and
   fade, how the tooltip looks. Three ASCII or SVG mockups, pick one, say why. Use the
   frontend-design sensibility; this popup is the product shot.
2. **Tune for the camera.** Slice paint-in animation (stagger under 400 ms total), a pulse
   on the request status line, the toast 4 s with a visible undo affordance, a `demo` flag
   in the popup that slows paint-in for recording without touching measured numbers.
   Tests in jsdom for any layout math.
3. **Pick the video.** A recent upload (days old) with a known sponsor read and no
   SponsorBlock coverage (check `searchSegments`). Note its id and the crowd status in
   `demo/README.md` so the claim "nobody has labeled it" is checkable on the day.
4. **Record.** QuickTime cropped to the window (not the 5120x1440 desktop), Chrome per
   CONTEXT.md, the shim or a real key behind the popup's endpoint. Then the two-pass
   palette ffmpeg command at 800 px and 15 fps for the README GIF under 5 MB, H.264 MP4
   for X. Three stills: a confident slice beside a faint one, the popup mid-request, the
   toast. Exact commands into `demo/README.md`.
5. **The post.** First line from CONTEXT.md section 8 with the measured numbers filled in
   verbatim, the clip, the install line. Draft an X thread of three posts (the skip, the
   popup internals, the accuracy with n and the false-skip guard), the Show HN title, the
   r/SponsorBlock post written after reading their rules ("different approach, not a
   replacement"), the r/youtube version. Human voice, no hype, no emoji, no em dashes.
6. **Awesome list line** for `~/Projects/mine/awesome-jev-typesafe`, in that repo's format.

Every visual change ships with its check. Commit locally; the user pushes and posts.
