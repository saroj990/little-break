# AdPause

Proof of concept Chrome extension. When Amazon Prime Video shows an advertisement, AdPause covers the player with a short information card. When the ad UI goes away, the card goes away. Playback is not blocked, skipped, muted, or sped up.

## Investigation (6 Nov 2026)

The signed-out homepage at `https://www.primevideo.com/` already loads the player shell:

- `#dv-web-player`
- `.atvwebplayersdk-player-container`
- `.atvwebplayersdk-video-surface`
- one hidden `<video>` (0×0, not playing)

The page loads this production bundle:

`https://cloudfront.xp-assets.aiv-cdn.net/family/web/ATVWebPlayerSDK-1.0/wave2/ATVWebPlayerSDK.js`

Class names are built in that bundle, not only in a debug build:

```js
debugClassName(name) => "atvwebplayersdk-" + name
```

The same helper produces the classes visible on the homepage (`atvwebplayersdk-player-container`, `atvwebplayersdk-video-surface`). Ad UI uses the same helper:

| Runtime class | Role |
|---|---|
| `atvwebplayersdk-ad-timer` | Ad timer shell |
| `atvwebplayersdk-ad-timer-countdown` | Countdown container |
| `atvwebplayersdk-ad-timer-remaining-time` | Remaining time |
| `atvwebplayersdk-ad-timer-text` / `ad-timer-ad-text` | Ad label |
| `atvwebplayersdk-ad-resume-message` | "Your program resumes…" line |
| `atvwebplayersdk-skip-ad-button` | Skip control. Detected only. Never clicked. |

`shouldShowAdTimer()` returns true only when there is a current ad break with a duration. It returns false when a modal is open, and for some Draper prerolls once the skip control takes over. The skip button class covers that second case.

English copy shipped in the same bundle, used only as a medium-confidence backup:

- `Your program resumes in {{seconds}} sec`
- `Ad - {{seconds}}`
- `Ad starts in {{seconds}}`

These are not ad signals and are ignored:

- `atvwebplayersdk-time-remaining-indicator` (title progress)
- `atvwebplayersdk-preview-timer-remaining-time` (preview)
- `atvwebplayersdk-skipelement-button` (skip intro / credits, not an ad)
- `atvwebplayersdk-go-ad-free-button` (upsell, not proof an ad is playing)

Ads are rendered in the same player `<video>`. There is no separate ad element to swap. A jump in `currentTime` is logged as low confidence and cannot open the overlay by itself.

### Feasibility

Detection is feasible when the ad-supported player shows that UI. It is not feasible from the video element alone, and it was not confirmed against a live ad break in this session (the browser was signed out, so playback never started). Titles without ads will never show the overlay. That is the correct result.

## Setup

```bash
npm install
npm test
npm run build
```

Load `dist/` in Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose "Load unpacked" and select the `dist` folder.
4. Open Prime Video, start a title, and use the toolbar popup.

Rebuild after code changes, then choose Reload on the extension card.

## How it is split

- `src/content/player-monitor.ts` finds the player, watches DOM changes, and reads playback state. It does not decide policy.
- `src/content/ad-detector.ts` maps signals to `IDLE`, `CONTENT_PLAYING`, `AD_PLAYING`, `PAUSED`, or `UNKNOWN`.
- `src/content/overlay-manager.ts` draws and removes the card. It never calls play, pause, seek, or volume.
- `src/popup/App.tsx` enables the extension, shows session counts, and can run a labeled simulation.
- `src/background/service-worker.ts` sets the default enabled flag on install.

State changes are logged in the page console as `[AdPause]` with the time, state, signal, confidence, and reason.

The popup button **Simulate ad** forces the overlay and is labeled "Diagnostic simulation". It is not counted as a detected interruption.

## Tests run here

| Check | Result |
|---|---|
| Detector unit tests (play, pause, high signal, medium copy, low signal ignored, disable, simulation) | `npm test` |
| Extension build (popup, service worker, content script) | `npm run build` |
| Signed-out Prime Video homepage exposes the ATV player shell and SDK bundle | Observed |
| Live ad start / end on a playing title | Not run. Requires a signed-in ad-supported playback. |
| Fullscreen and title changes during a real ad | Not run, for the same reason. |

On a watch page, "Simulate ad" then "End simulation" is the stand-in for the overlay path until a real break is available. Disable should remove the card immediately.

## Limitations

- Selectors live in one module because Amazon can change the player in any deploy.
- Subscribers on ad-free playback will see no overlay. There is often no ad signal to find.
- If the player fullscreens the raw `<video>` element, a sibling overlay cannot be drawn on top of that fullscreen surface. Prime usually fullscreens the player container.
- Countdown text is parsed only for `m:ss` and the English sentences above. Elapsed time is measured from the moment the signal appears, so it can miss the first fraction of a second.
- The extension does not look at manifests, EME, or network traffic.
