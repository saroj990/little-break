import type { Confidence, DetectionSnapshot, PlaybackState } from "../shared/types.ts";

/**
 * Prime Video ad indicators, isolated from the monitor.
 *
 * Verified 2026-11-06 against the production bundle loaded by www.primevideo.com:
 * ATVWebPlayerSDK.js builds class names with
 * debugClassName(name) => "atvwebplayersdk-" + name.
 * The ad timer is created only while shouldShowAdTimer() is true
 * (an ad break with duration, and not a Draper preroll that has switched to Skip).
 *
 * These selectors are candidates. A missing node means "no signal", not an error.
 */
export interface AdIndicator {
  id: string;
  confidence: Exclude<Confidence, "none">;
  /** CSS selector queried inside the player root. */
  selector: string;
  description: string;
}

export const AD_INDICATORS: readonly AdIndicator[] = [
  {
    id: "ad-timer",
    confidence: "high",
    selector: ".atvwebplayersdk-ad-timer",
    description: "SDK ad-timer shell, mounted for an active ad break",
  },
  {
    id: "ad-timer-countdown",
    confidence: "high",
    selector: ".atvwebplayersdk-ad-timer-countdown",
    description: "SDK ad countdown container",
  },
  {
    id: "ad-timer-remaining",
    confidence: "high",
    selector: ".atvwebplayersdk-ad-timer-remaining-time",
    description: "SDK remaining-time label inside the ad timer",
  },
  {
    id: "ad-timer-text",
    confidence: "high",
    selector: ".atvwebplayersdk-ad-timer-text, .atvwebplayersdk-ad-timer-ad-text",
    description: "SDK ad label or countdown text",
  },
  {
    id: "ad-resume-message",
    confidence: "high",
    selector: ".atvwebplayersdk-ad-resume-message",
    description: "SDK 'program resumes' line rendered with the ad timer",
  },
  {
    id: "skip-ad-button",
    confidence: "high",
    selector: ".atvwebplayersdk-skip-ad-button",
    description: "SDK skip-ad control. Presence only — never clicked.",
  },
  // Sony LIV (player.sonyliv.com SPN player + Google IMA / DAI). Verified 2026-11-11.
  {
    id: "sonyliv-ad-wrapper",
    confidence: "high",
    selector: ".ad-wrapper",
    description: "Sony LIV IMA ad layer (hidden via .ad-layer-hidden when idle)",
  },
  {
    id: "sonyliv-ad-controls",
    confidence: "high",
    selector: ".ad-controls",
    description: "Sony LIV ad chrome mounted during an ad break",
  },
  {
    id: "sonyliv-ad-timer",
    confidence: "high",
    selector: ".ad-timer-container, .ad-label-timer",
    description: "Sony LIV ad countdown timer",
  },
  {
    id: "sonyliv-ad-label",
    confidence: "high",
    selector: ".ad-label-text, .ad-label-container",
    description: "Sony LIV on-screen AD label",
  },
  {
    id: "sonyliv-dai-playing",
    confidence: "high",
    selector: ".dai-ad-playing",
    description: "Sony LIV player wrapper marked while a DAI ad plays",
  },
  {
    id: "sonyliv-skip-ad",
    confidence: "high",
    selector: ".skip_ad",
    description: "Sony LIV skip-ad control. Presence only — never clicked.",
  },
];

/** Copy from the player bundle's English avod strings. Scoped to the player root. */
export const AD_COPY_PATTERNS: readonly RegExp[] = [
  /^Your program resumes in \d+ sec$/,
  /^Ad - \d+$/,
  /^Ad starts in \d+$/,
  /^Ad \d+ of \d+ playing\b/,
];

export function matchesAdCopy(text: string): boolean {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value || value.length > 120) return false;
  return AD_COPY_PATTERNS.some((pattern) => pattern.test(value));
}

/** JioHotstar / Hotstar puts the commercial in this element, beside #video-container. */
export const HOTSTAR_AD_CONTAINER_ID = "ad-video-container";
export const HOTSTAR_CONTENT_CONTAINER_ID = "video-container";

export interface HotstarMediaProbe {
  visible: boolean;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  readyState: number;
}

/**
 * True while the ad element is actually on screen.
 * A paused frame partway through still counts. A hidden, ended, or not-yet-started element does not.
 */
export function hotstarAdVisible(probe: HotstarMediaProbe): boolean {
  if (!probe.visible || probe.ended) return false;
  if (probe.readyState < 2 && probe.paused) return false;
  if (probe.paused && probe.currentTime <= 0.05) return false;
  return true;
}

export interface AudioLevel {
  muted: boolean;
  volume: number;
}

/**
 * Level to write onto the Hotstar show video after an ad.
 * A remembered pre-ad level wins. If the show element was created during the ad
 * already sitting at volume 0, fall back to audible playback.
 */
export function contentAudioToRestore(remembered: AudioLevel | null, liveVolume: number): AudioLevel {
  if (remembered) return { muted: remembered.muted, volume: remembered.volume };
  if (liveVolume === 0) return { muted: false, volume: 1 };
  return { muted: false, volume: liveVolume };
}

/** Remaining time from the ad element's own duration. Ignores feature-length media. */
export function remainingFromMedia(duration: number, currentTime: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180) return null;
  if (!Number.isFinite(currentTime) || currentTime < 0) return null;
  const left = Math.ceil(duration - currentTime);
  if (left < 0 || left > 180) return null;
  return left;
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export interface PlayerObservation {
  hasPlayerShell: boolean;
  hasActiveVideo: boolean;
  paused: boolean;
  readyState: number;
  /** Visible indicator ids, strongest first is not required. */
  signals: Array<{ id: string; confidence: Exclude<Confidence, "none">; detail: string }>;
  remainingSeconds: number | null;
  simulated: boolean;
}

/**
 * Prime's play/pause control uses a hardcoded accessibility label:
 * "Pause" while playback is running, "Play" while it is paused.
 * Returns null when the label is missing or not one of those two words.
 */
export function pausedFromControlLabel(label: string | null | undefined): boolean | null {
  if (!label) return null;
  const value = label.trim().toLowerCase();
  if (value === "play") return true;
  if (value === "pause") return false;
  return null;
}

export function parseRemainingSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, " ").trim();
  const clock = value.match(/^(\d+):(\d{2})$/);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }
  const sentence = value.match(/^(?:Your program resumes in |Ad - |Ad starts in )(\d+)$/);
  if (sentence) return Number(sentence[1]);
  const labeled = value.match(/(\d+)\s*sec\b/i);
  if (labeled && /ad|program resumes/i.test(value)) return Number(labeled[1]);
  return null;
}

/** Sony LIV splits remaining time across .ad-timer-mm ("0:") and .ad-timer-ss ("12"). */
export function parseSonyAdTimer(
  minutesText: string | null | undefined,
  secondsText: string | null | undefined,
): number | null {
  const minutes = Number(String(minutesText ?? "").replace(/[^\d]/g, ""));
  const seconds = Number(String(secondsText ?? "").replace(/[^\d]/g, ""));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (seconds > 59) return null;
  const total = minutes * 60 + seconds;
  if (total <= 0 || total > 180) return null;
  return total;
}

export function strongestSignal(
  signals: PlayerObservation["signals"],
): PlayerObservation["signals"][number] | null {
  let best: PlayerObservation["signals"][number] | null = null;
  for (const signal of signals) {
    if (!best || CONFIDENCE_RANK[signal.confidence] > CONFIDENCE_RANK[best.confidence]) {
      best = signal;
    }
  }
  return best;
}

/**
 * Low-confidence signals are logged by the caller and must not select AD_PLAYING.
 * Medium and high signals can.
 */
export function detect(observation: PlayerObservation): DetectionSnapshot {
  if (observation.simulated) {
    return {
      state: "AD_PLAYING",
      confidence: "high",
      signalId: "simulated",
      reason: "Diagnostic simulation. This is not a real advertisement.",
      remainingSeconds: null,
      simulated: true,
    };
  }

  const actionable = observation.signals.filter((signal) => signal.confidence !== "low");
  const best = strongestSignal(actionable);
  const low = observation.signals.find((signal) => signal.confidence === "low");

  if (best) {
    if (observation.paused) {
      return {
        state: "PAUSED",
        confidence: best.confidence,
        signalId: best.id,
        reason: "Advertisement is paused.",
        remainingSeconds: observation.remainingSeconds,
        simulated: false,
      };
    }
    return {
      state: "AD_PLAYING",
      confidence: best.confidence,
      signalId: best.id,
      reason: best.detail,
      remainingSeconds: observation.remainingSeconds,
      simulated: false,
    };
  }

  const lowNote = low ? ` Ignored low-confidence signal: ${low.detail}` : "";

  if (!observation.hasPlayerShell) {
    return idle("No player shell on this page." + lowNote);
  }

  if (!observation.hasActiveVideo) {
    return idle("Player shell is present, but no active video is showing." + lowNote);
  }

  if (observation.readyState < 2) {
    if (observation.paused) {
      return idle("Player is open. Start playback to monitor for an advertisement." + lowNote);
    }
    return snapshot(
      "UNKNOWN",
      "low",
      low?.id ?? null,
      "Video element is attached, but metadata is not available yet." + lowNote,
    );
  }

  if (observation.paused) {
    return snapshot(
      "PAUSED",
      low ? "low" : "none",
      low?.id ?? null,
      "Playback is paused and no advertisement UI is visible." + lowNote,
    );
  }

  return snapshot(
    "CONTENT_PLAYING",
    low ? "low" : "none",
    low?.id ?? null,
    "Video is playing and no advertisement UI is visible." + lowNote,
  );
}

export function shouldShowOverlay(snapshot: DetectionSnapshot, enabled: boolean): boolean {
  if (!enabled) return false;
  if (snapshot.state !== "AD_PLAYING") return false;
  return snapshot.confidence === "high" || snapshot.confidence === "medium";
}

/**
 * What to do with the overlay for an ad break that is already latched.
 * A missing video or a player-driven pause must not drop the cover:
 * those blips happen between creatives and were flashing the ad through.
 * Only an explicit viewer pause reveals the picture.
 */
export function adBreakAction(input: {
  enabled: boolean;
  coverActive: boolean;
  hasPlayer: boolean;
  userPaused: boolean;
}): "show" | "paused" | "end" {
  if (!input.enabled || !input.coverActive || !input.hasPlayer) return "end";
  if (input.userPaused) return "paused";
  return "show";
}

function idle(reason: string): DetectionSnapshot {
  return snapshot("IDLE", "none", null, reason);
}

function snapshot(
  state: PlaybackState,
  confidence: Confidence,
  signalId: string | null,
  reason: string,
): DetectionSnapshot {
  return {
    state,
    confidence,
    signalId,
    reason,
    remainingSeconds: null,
    simulated: false,
  };
}
