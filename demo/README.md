# The demo clip

`demo.mp4` (2.6MB, for X) and `demo.gif` (4.6MB, for the README) are one continuous 8.6
second take on Corridor Crew's "VFX Artists React to BOLLYWOOD Bad & Great CGi 8", recorded
2026-09-19 in Chrome 153.

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

    0.0s  page loads, bar empty
    ~2s   10 slices fade in, staggered: 6 confident, 4 faint
    ~3s   the playhead reaches the sponsor and the video jumps 0:03 to 0:41
          toast: skipped 38s of sponsor (0.88) · undo
    ~6s   the pointer rests on a faint slice at 24:45
          tooltip: outro 43% · the transcript line behind it

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

    ffmpeg -y -framerate 37.69 -i demo/raw/frame-%05d.jpg -vcodec libx264 -pix_fmt yuv420p -crf 20 -an demo/demo.mp4
    ffmpeg -y -i demo/demo.mp4 -vf "fps=13,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 demo/demo.gif

Use the framerate `record-demo.mjs` prints; the screencast does not run at a fixed rate.
Keep the GIF under 5MB: 720px at 13fps lands at 4.6MB. `demo/raw/` is gitignored, 58MB of
jpegs.

## What the camera found

Two bugs, both fixed, both visible in the first take: the tooltip wrapped into an unreadable
column at the right edge of the bar, and the toast was positioned against the window rather
than the player, so it landed over the page next to the Download button. The tooltip also
lived inside the progress bar's stacking context, where YouTube's own seek preview covered
it; it hangs off the player now.
