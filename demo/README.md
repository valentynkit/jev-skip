# The demo clip

`demo.mp4` (2.5MB, 1280x504, for X) and `demo.gif` (3.9MB, 720px, for the README) are one
continuous 9 second take on Corridor Crew's "VFX Artists React to BOLLYWOOD Bad & Great CGi
8", recorded 2026-09-19 in Chrome 153.

The frame is two real surfaces side by side: the watch page on the left, the extension's
own popup on the right, filmed at the same moment and resampled onto one timeline. The
popup carries the shot, because a 6px seek bar is unreadable on a phone and the popup's
mini timeline is not.

## What the take shows, and what it is

Real: the extension reads the caption track itself, cuts it into 50 segments, sends one
request, paints 10 slices, and skips 38 seconds of a Squarespace read without being told
where it is.

Replayed: the answers come from `fixtures/answers/`, recorded 2026-09-18 through the Vercel
AI Gateway shim, served back by `scripts/answer-server.mjs` at their recorded latency
(~0.9s, the same number the README publishes). There is no key on this machine, so no clip
today contains a live call.

**The line that has to appear wherever this clip appears:**

> Answers recorded 2026-09-18 and replayed from the repo; the request in the clip goes to
> localhost. Everything else is live.

Do not pair this clip with "on a video nobody has labeled". Every corpus video is
SponsorBlock-labeled, which is how it was scored. That claim needs a key and a fresh upload.

Timeline of the take:

    0.0s  page loads, bar empty, popup idle
    ~2s   10 slices fade in, staggered: 6 confident, 4 faint
          popup: 50 segments · 25.3k est. tokens · $0.0011 · done in 1546 ms · 50 judged
          and the legend fills in: content 40, sponsor 5, intro 2, outro 2, self_promo 1
    ~3s   the playhead reaches the sponsor and the video jumps 0:03 to 0:41
          toast: skipped 38s of sponsor (0.88) · undo
    ~6s   the pointer rests on a faint slice at 24:45
          tooltip: outro 43% · the transcript line behind it

The token count and the cost are the ones the recorded call actually billed, not an
estimate: 25.3k input tokens on a 25 minute video, against the 18.1k mean the README
publishes.

Stills pulled from the same take: `still-before.jpg` (bar empty, video playing),
`still-toast.jpg` (the skip landing), `still-tooltip.jpg` (doubt, with its reason).

## Reproducing it

    JEV_ALLOW_LOCALHOST=1 npm run build
    node scripts/answer-server.mjs --port 4333        # leave running

Chrome 137 dropped `--load-extension`, so the extension goes in by hand, once:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --remote-debugging-port=9223 --user-data-dir=/tmp/jev-chrome-manual

then `chrome://extensions`, developer mode, load unpacked, `dist/chrome-mv3`. After that:

    node scripts/cdp.mjs setup                        # endpoint into the popup
    node scripts/record-demo.mjs 2wuUSEFjr50 --port 9223 --out demo/raw

`record-demo.mjs` films the page over CDP, so the capture is the tab and nothing else on the
desktop. It stages nothing: it loads the page, keeps the pointer alive so YouTube does not
fade its controls, and waits. The skip fires on its own.

Takes fail perhaps one in three, painting nothing, when the player does not ask for captions
before the recording window closes. Run it again.

## Encoding

    cd demo
    ffmpeg -y -framerate 38.16 -i raw/frame-%05d.jpg -framerate 38.16 -i raw-popup/frame-%05d.jpg \
      -filter_complex "[0:v]crop=992:560:16:68[p];[1:v]crop=340:440:0:0,scale=-2:560[q];[p][q]hstack=inputs=2,scale=1280:-2[v]" \
      -map "[v]" -vcodec libx264 -pix_fmt yuv420p -crf 20 -an demo.mp4
    ffmpeg -y -i demo.mp4 -vf "fps=11,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 demo.gif

The crop numbers come from the live page at a 1440x900 viewport: player at 16,68 sized
989x556, progress bar at 28,562 sized 965x6. Measure again if the viewport changes.

Use the framerate `record-demo.mjs` prints; the screencast does not run at a fixed rate.
Keep the GIF under 5MB: 720px at 11fps lands at 3.9MB. `demo/raw/` and `demo/raw-popup/`
are gitignored.

## What the camera found

Five bugs, all fixed, none of which any test would have caught:

- The tooltip wrapped into a column three words wide at the right edge of the bar.
- The tooltip sat inside the progress bar's stacking context, where YouTube's own seek
  preview covered it. It hangs off the player now.
- The toast was positioned against the window rather than the player, so it landed over the
  page next to the Download button.
- Probability was drawn as transparency, which let the video through: the heatmap read as
  noise on a bright scene and vanished on a dark one. It is colour strength against a fixed
  base now, so a faint slice looks the same over any frame.
- The popup asked the page for the title and channel and then read the answer before it
  arrived, so the channel line stayed on its placeholder.

Trying to film something is a different kind of test than running it.
