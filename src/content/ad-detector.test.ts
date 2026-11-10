import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adBreakAction,
  detect,
  contentAudioToRestore,
  hotstarAdVisible,
  parseRemainingSeconds,
  pausedFromControlLabel,
  remainingFromMedia,
  shouldShowOverlay,
} from "./ad-detector.ts";
import type { PlayerObservation } from "./ad-detector.ts";

function observe(partial: Partial<PlayerObservation>): PlayerObservation {
  return {
    hasPlayerShell: true,
    hasActiveVideo: true,
    paused: false,
    readyState: 4,
    signals: [],
    remainingSeconds: null,
    simulated: false,
    ...partial,
  };
}

describe("detect", () => {
  it("stays idle without a player", () => {
    const snapshot = detect(observe({ hasPlayerShell: false, hasActiveVideo: false }));
    assert.equal(snapshot.state, "IDLE");
    assert.equal(shouldShowOverlay(snapshot, true), false);
  });

  it("does not cover normal playback", () => {
    const snapshot = detect(observe({}));
    assert.equal(snapshot.state, "CONTENT_PLAYING");
    assert.equal(shouldShowOverlay(snapshot, true), false);
  });

  it("treats a paused detail page before playback as idle", () => {
    const snapshot = detect(observe({ paused: true, readyState: 0 }));
    assert.equal(snapshot.state, "IDLE");
    assert.match(snapshot.reason, /Start playback/);
    assert.equal(shouldShowOverlay(snapshot, true), false);
  });

  it("does not cover a paused movie", () => {
    const snapshot = detect(observe({ paused: true }));
    assert.equal(snapshot.state, "PAUSED");
    assert.equal(shouldShowOverlay(snapshot, true), false);
  });

  it("shows the overlay for a high-confidence ad timer", () => {
    const snapshot = detect(
      observe({
        remainingSeconds: 20,
        signals: [{ id: "ad-timer", confidence: "high", detail: "Ad timer visible" }],
      }),
    );
    assert.equal(snapshot.state, "AD_PLAYING");
    assert.equal(snapshot.remainingSeconds, 20);
    assert.equal(shouldShowOverlay(snapshot, true), true);
  });

  it("hides the overlay when an advertisement is paused", () => {
    const snapshot = detect(
      observe({
        paused: true,
        signals: [{ id: "ad-timer", confidence: "high", detail: "Ad timer visible" }],
      }),
    );
    assert.equal(snapshot.state, "PAUSED");
    assert.equal(snapshot.signalId, "ad-timer");
    assert.equal(shouldShowOverlay(snapshot, true), false);
  });

  it("shows the overlay for medium-confidence countdown copy", () => {
    const snapshot = detect(
      observe({
        signals: [
          {
            id: "ad-countdown-copy",
            confidence: "medium",
            detail: "Matched: Your program resumes in 15 sec",
          },
        ],
      }),
    );
    assert.equal(snapshot.state, "AD_PLAYING");
    assert.equal(snapshot.confidence, "medium");
  });

  it("ignores a low-confidence signal on its own", () => {
    const snapshot = detect(
      observe({
        signals: [{ id: "time-jump", confidence: "low", detail: "currentTime jumped" }],
      }),
    );
    assert.equal(snapshot.state, "CONTENT_PLAYING");
    assert.match(snapshot.reason, /Ignored low-confidence/);
    assert.equal(shouldShowOverlay(snapshot, true), false);
  });

  it("hides the overlay when the extension is disabled", () => {
    const snapshot = detect(
      observe({
        signals: [{ id: "ad-timer", confidence: "high", detail: "Ad timer visible" }],
      }),
    );
    assert.equal(shouldShowOverlay(snapshot, false), false);
  });

  it("labels a simulation and does not pretend it is a real ad signal", () => {
    const snapshot = detect(observe({ simulated: true, signals: [] }));
    assert.equal(snapshot.simulated, true);
    assert.equal(snapshot.signalId, "simulated");
    assert.match(snapshot.reason, /not a real advertisement/);
  });
});

describe("adBreakAction", () => {
  it("keeps the overlay up through a player pause or a missing video", () => {
    assert.equal(
      adBreakAction({ enabled: true, coverActive: true, hasPlayer: true, userPaused: false }),
      "show",
    );
  });

  it("hides the overlay only when the viewer paused", () => {
    assert.equal(
      adBreakAction({ enabled: true, coverActive: true, hasPlayer: true, userPaused: true }),
      "paused",
    );
  });

  it("ends the break once the cover expires", () => {
    assert.equal(
      adBreakAction({ enabled: true, coverActive: false, hasPlayer: true, userPaused: false }),
      "end",
    );
  });
});

describe("pausedFromControlLabel", () => {
  it("follows Prime's play/pause button label", () => {
    assert.equal(pausedFromControlLabel("Play"), true);
    assert.equal(pausedFromControlLabel(" pause "), false);
    assert.equal(pausedFromControlLabel("Play trailer"), null);
    assert.equal(pausedFromControlLabel(null), null);
  });
});

describe("hotstar ad video", () => {
  it("treats a visible playing ad as an advertisement", () => {
    assert.equal(
      hotstarAdVisible({ visible: true, paused: false, ended: false, currentTime: 0, readyState: 4 }),
      true,
    );
  });

  it("keeps a paused ad that has already started", () => {
    assert.equal(
      hotstarAdVisible({ visible: true, paused: true, ended: false, currentTime: 8, readyState: 4 }),
      true,
    );
  });

  it("ignores a hidden, ended, or not-yet-started ad element", () => {
    assert.equal(
      hotstarAdVisible({ visible: false, paused: false, ended: false, currentTime: 2, readyState: 4 }),
      false,
    );
    assert.equal(
      hotstarAdVisible({ visible: true, paused: true, ended: true, currentTime: 20, readyState: 4 }),
      false,
    );
    assert.equal(
      hotstarAdVisible({ visible: true, paused: true, ended: false, currentTime: 0, readyState: 4 }),
      false,
    );
  });

  it("restores the show level from before the ad", () => {
    assert.deepEqual(contentAudioToRestore({ muted: false, volume: 0.4 }, 0), {
      muted: false,
      volume: 0.4,
    });
    assert.deepEqual(contentAudioToRestore({ muted: true, volume: 1 }, 0), {
      muted: true,
      volume: 1,
    });
  });

  it("unmutes a show video that only appeared during the ad", () => {
    assert.deepEqual(contentAudioToRestore(null, 0), { muted: false, volume: 1 });
    assert.deepEqual(contentAudioToRestore(null, 0.7), { muted: false, volume: 0.7 });
  });

  it("reads remaining time from a short ad and ignores a movie", () => {
    assert.equal(remainingFromMedia(30, 12.2), 18);
    assert.equal(remainingFromMedia(30, 30), 0);
    assert.equal(remainingFromMedia(3600, 12), null);
    assert.equal(remainingFromMedia(Number.POSITIVE_INFINITY, 4), null);
  });
});

describe("parseRemainingSeconds", () => {
  it("parses clock text and the SDK countdown sentences", () => {
    assert.equal(parseRemainingSeconds("0:30"), 30);
    assert.equal(parseRemainingSeconds("1:05"), 65);
    assert.equal(parseRemainingSeconds("Your program resumes in 12 sec"), 12);
    assert.equal(parseRemainingSeconds("Ad - 8"), 8);
    assert.equal(parseRemainingSeconds("Feature"), null);
    assert.equal(parseRemainingSeconds("Add to Watchlist"), null);
  });
});
