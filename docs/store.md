# Store listings

Draft copy for the Chrome Web Store and the Firefox self-distribution route. Nothing here
has been submitted.

## Chrome Web Store

**Name**: jev-skip

**Short summary** (132 characters max)

    Skips YouTube sponsors on videos nobody has labeled yet. Reads the captions, paints a
    probability heatmap, skips when it is sure.

**Description**

    Every sponsor skipper waits for a stranger to submit the timestamps. That works well
    once a video is popular and not at all in the first hours, which is when most people
    watch it.

    jev-skip reads the caption track of the video you are already watching, asks a model
    once for a category per 30-second segment, and paints the answer on the seek bar. A
    confident sponsor is a solid slice, a borderline one is a ghost, and only the confident
    ones are skipped. Hover any slice to see the line of transcript behind it.

    You bring your own API key. There is no server in the middle and no account.

    Measured on 23 videos with crowd labels: 77% of the labeled sponsor seconds caught, 34
    seconds an hour of false skips as an upper bound, $0.0008 a video. The numbers and the
    script that produces them are in the repository.

    Limits worth knowing before you install: it reads text, so a video with no captions
    gets no opinion at all, and the extension does nothing. Non-English captions are weaker.

**Category**: Productivity. **Language**: English.

### Permission justifications

| Permission | Why |
| --- | --- |
| `storage` | Holds your API key, the skip threshold and the auto-skip toggle. The key is read only by the background worker, never by the code running inside the page. |
| `https://*.youtube.com/*` | The extension reads the caption track and paints the seek bar on watch pages. Nothing outside youtube.com is touched. |
| `https://api.typesafe.ai/*` | Where the transcript goes to be judged, under your key. This is the only outbound request the extension makes. |

No `tabs`, no `webRequest`, no content script outside youtube.com.

### Privacy policy

    jev-skip has no server and collects nothing. No analytics, no telemetry, no crash
    reporting, no account.

    What leaves your browser: the caption text of the video you are watching, its title and
    channel name, sent to the API endpoint you configured, authenticated with the key you
    pasted. Nothing else. That request is made by the extension's background worker, and
    the key never reaches the page or the content script.

    What stays on your machine: your key, your threshold, your auto-skip setting, and the
    current video's trace, all in extension storage. Uninstalling removes them.

    The endpoint is configurable, so the recipient is whoever you point it at. The default
    is api.typesafe.ai, whose own terms then apply to that text.

## Firefox

Firefox builds MV2, because Firefox MV3 makes host permissions opt-in and the extension
would silently do nothing until the user granted them.

Self-distribution, which avoids AMO review for a tool that needs the user's own key:

1. `npm run zip:firefox`
2. Submit the zip at addons.mozilla.org, "On your own" distribution, to get it signed.
3. Mozilla returns a signed `.xpi`. Host it anywhere; Firefox installs a signed xpi from
   any URL.

For a temporary install with no signing at all: `about:debugging`, this Firefox, load
temporary add-on, pick `dist/firefox-mv2/manifest.json`. It goes away on restart.

## Before either listing goes live

The extension has not been through a store review and has never run a full session on a
real logged-in watch page. `docs/browser-ground-truth.md` lists what is still unverified.
Do not submit until that file is empty of blockers.
