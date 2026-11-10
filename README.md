# AdPause

AdPause is a Chrome extension for **Amazon Prime Video** and **Hotstar / JioHotstar**. When a video advertisement starts, it covers the picture with a short “did you know?” card and **mutes** the ad. When the ad ends, the card disappears and normal playback sound comes back.

It does **not** skip, block, speed up, or click through ads. It does not change DRM or network traffic.

## What it does

- Detects when the streaming player is in an ad break (Prime UI timers and labels; Hotstar’s separate ad player).
- Shows a full-screen overlay on top of the video with a rotating fact and a simple timer.
- Mutes ad audio while the break is active, then restores sound for the show or movie.
- If **you** pause during an ad, the overlay hides so you can see the paused frame. Mute stays on until the ad finishes or you turn the extension off.
- Counts how many ad breaks it covered and how long they lasted (toolbar popup).

## What it does not do

- Skip or shorten ads.
- Remove banner or page ads outside the video player.
- Guarantee coverage on every title (some accounts or titles have no ads; some player changes may break detection until the extension is updated).

## Supported sites

| Service | URLs (examples) |
|--------|------------------|
| Prime Video | `primevideo.com`, Amazon `/gp/video/` storefronts |
| Hotstar | `hotstar.com`, `jiohotstar.com` |

You must be watching **in the browser** on one of these sites. The extension only runs on matched pages.

## How to install (Chrome)

You need a built copy of the extension (`dist/` folder).

**If you have the source repo:**

```bash
npm install
npm run build
```

**Load in Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **`dist`** folder inside this project.
4. Pin **AdPause** from the extensions menu if you like.

After code changes, run `npm run build` again and click **Reload** on the extension card on `chrome://extensions`.

## How to use

1. **Turn it on** — Open the AdPause icon in the toolbar. The **Enabled** switch should be on (default after install).
2. **Start watching** — Open Prime Video or Hotstar in a tab and play a title that shows in-video ads.
3. **During an ad** — The overlay appears automatically. You can keep watching the timer on the card; the ad still plays underneath, without sound.
4. **After the ad** — The card goes away and program audio should return. On Hotstar, sound may take a second or two while the player settles.
5. **Popup details** — Status, signal name, interruption count, and total ad time. Useful to confirm the tab is connected.
6. **Simulate ad** (optional) — In the popup, **Simulate ad** previews the card **without** a real ad and **without** muting. Use **End simulation** to dismiss. Simulated breaks are not counted as real ads.

If the popup says the tab has not connected yet, **reload the watch page** and open AdPause again.

## Permissions (why Chrome asks)

- **Storage** — Remember enabled/disabled and show status in the popup.
- **Active tab & scripting** — Talk to the player page on Prime/Hotstar and inject the content script when needed.

No account data is sent to a server; behavior is local in your browser.

## Tips & troubleshooting

| Issue | Try |
|--------|-----|
| No overlay on a real ad | Confirm you’re on a supported URL, extension is enabled, and the tab was open before or refreshed after install. |
| Popup says “Not on Prime Video or Hotstar” | Switch to a watch tab on those sites. |
| Sound still off after a Hotstar ad | Wait a few seconds; refresh the page if needed. Report if it persists. |
| Overlay on simulate only, never on live ads | Title may be ad-free, or the player UI changed. Check the page console for `[AdPause]` logs. |

## For developers

```bash
npm test    # detector unit tests
npm run build
```

Main pieces: `player-monitor.ts` (DOM + player), `ad-detector.ts` (state machine), `overlay-manager.ts` (card UI), `src/popup/App.tsx` (popup), `src/content/index.ts` (mute, cover timing, session stats).

State changes log in the page console as `[AdPause]` with state, signal, confidence, and reason.
