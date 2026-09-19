# Contributing

## Running it

    npm install
    npm test          # 37 tests, offline, no key
    npm run build     # dist/chrome-mv3
    npm run build:firefox

Tests never touch the network. Anything that would call Jev goes through
`scripts/fake-jev.ts`, which answers from a keyword heuristic or from a fixture file you
hand it. A test that needs a key is a test that is wrong.

## Loading it

Chrome: `chrome://extensions`, developer mode on, load unpacked, pick `dist/chrome-mv3`.
Firefox: `about:debugging`, this Firefox, load temporary add-on, pick
`dist/firefox-mv2/manifest.json`. Open the popup and paste your key; it goes to
`browser.storage.local` and only the background worker ever reads it.

To drive it without clicking, `node scripts/drive.mjs <videoId>` loads the built extension
into a Chromium and prints the resulting trace. Note that YouTube shows an automated
profile a bot wall, so this only proves the wiring, never the numbers. See
`docs/browser-ground-truth.md`.

## Adding a video to the corpus

The corpus is chosen by a rule, not by hand, so anyone can rebuild it: walk SponsorBlock's
k-anonymity hash prefixes in ascending order, keep sponsor segments with `locked=1` and at
least 5 votes on videos 6 to 40 minutes long, one video per channel, sort by video id, take
the first 30. Of those 30, the ones with no readable English caption track drop out, which
is how 30 becomes 23.

    node scripts/record.ts --dry-run   # print the selection, write nothing
    node scripts/record.ts --corpus    # write fixtures/videos.json, captions, crowd files
    node scripts/record.ts --fake      # judge it with the fake, no network

Captions come from `yt-dlp`, because the timedtext URL is session-signed and only works
from inside a watch tab.

## Recording real answers

`npm run record` is the only command that needs a key. It caches each answer under the
sha256 of the request, so a re-run costs nothing for anything already recorded. Set
`JEV_BASE_URL` if you are answering through a shim rather than the direct API, and say so
wherever the resulting numbers get published.

## Measuring

    npm run measure

Offline, over `fixtures/`, prints the four headline lines and writes `measure.json`.
`thresholds.json` is a regression guard: it fails the run if recall drops or the false-skip
rate climbs. It is not a published threshold.

## House rules

Fewest files that work. Deliberate shortcuts carry a `ponytail:` comment naming the ceiling
they stop at. Every error path fails toward `content`, which means no skip: doubt never
costs the viewer part of the video. Commit messages and comments read as prose, no em
dashes.
