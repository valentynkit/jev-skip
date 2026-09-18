# Recording the demo clip

The clip is one take: popup open on a watch page, the bar filling in as answers land, then a
skip firing with the toast. Chrome, because the 150ms lead makes the skip look instant.

1. Open a video with a sponsor read that SponsorBlock has never seen, popup pinned open.
2. QuickTime, File > New Screen Recording, drag a box around the player plus the popup. Not
   the whole 5120x1440 display. Save as `demo/recording.mov`.
3. GIF for the README, two-pass palette so the flat UI colors stay clean:

   ffmpeg -i demo/recording.mov -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=none" -loop 0 demo/demo.gif

4. MP4 for X, which re-encodes GIFs to muted video anyway:

   ffmpeg -i demo/recording.mov -vcodec libx264 -pix_fmt yuv420p -crf 20 -an demo/demo.mp4

Keep the GIF under 5MB. If it lands over, drop to 640px width before touching the frame rate.
