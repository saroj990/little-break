import { adBreakAction, contentAudioToRestore, shouldShowOverlay, type AudioLevel } from "./ad-detector.ts";
import { OverlayManager } from "./overlay-manager.ts";
import { PlayerMonitor } from "./player-monitor.ts";
import { cardForInterruption } from "../data/sample-content.ts";
import { FEED_STORAGE_KEY, isStoredContentFeed, type ContentCard } from "../shared/content-card.ts";
import { isExtensionMessage } from "../shared/messages.ts";
import type { DetectionSnapshot, SessionStatus } from "../shared/types.ts";

const ENABLED_KEY = "enabled";

let enabled = true;
let simulated = false;
let feedCards: ContentCard[] = [];
let adCount = 0;
let adDurationMs = 0;
let adStartedAt: number | null = null;
let countingRealAd = false;
let latest: DetectionSnapshot = {
  state: "IDLE",
  confidence: "none",
  signalId: null,
  reason: "Waiting for the player.",
  remainingSeconds: null,
  simulated: false,
};

const overlay = new OverlayManager();
let monitor: PlayerMonitor | null = null;
let clockId = 0;
let muteFrame = 0;
let hideTimer = 0;
let coverUntil = 0;
let coverFrozenAt = 0;
const savedAudio = new Map<HTMLVideoElement, AudioLevel>();
let hotstarLevel: AudioLevel | null = null;
let settling = false;
let settleFrame = 0;
let settleGuard: ((event: Event) => void) | null = null;

function currentStatus(): SessionStatus {
  return {
    enabled,
    onPrimeVideo: true,
    state: latest.state,
    confidence: latest.confidence,
    signalId: latest.signalId,
    reason: latest.reason,
    adCount,
    adDurationMs: liveDuration(),
    simulated: latest.simulated,
    updatedAt: Date.now(),
  };
}

function liveDuration(): number {
  if (!countingRealAd || adStartedAt == null) return adDurationMs;
  return adDurationMs + (Date.now() - adStartedAt);
}

function publish(): void {
  void chrome.storage.session.set({ status: currentStatus() });
}

function finishOpenAd(): void {
  holdOpenAd();
  countingRealAd = false;
  coverUntil = 0;
  coverFrozenAt = 0;
  stopMuteLoop();
  restoreAudio();
  settleHotstarAudio();
}

function holdOpenAd(): void {
  if (!countingRealAd || adStartedAt == null) return;
  adDurationMs += Date.now() - adStartedAt;
  adStartedAt = null;
}

function hasAdSignal(snapshot: DetectionSnapshot): boolean {
  return (
    !snapshot.simulated &&
    snapshot.signalId != null &&
    snapshot.signalId !== "time-jump" &&
    (snapshot.confidence === "high" || snapshot.confidence === "medium")
  );
}

function extendCover(snapshot: DetectionSnapshot): void {
  if (!hasAdSignal(snapshot)) return;
  const now = Date.now();
  const remaining = snapshot.remainingSeconds;
  if (remaining === 0) {
    coverUntil = Math.max(coverUntil, now + 600);
    return;
  }
  if (remaining != null && remaining > 0 && remaining < 180) {
    coverUntil = Math.max(coverUntil, now + remaining * 1000 + 800);
    return;
  }
  coverUntil = Math.max(coverUntil, now + 5000);
}

function freezeCover(): void {
  if (coverFrozenAt !== 0 || coverUntil <= Date.now()) return;
  coverFrozenAt = Date.now();
}

function thawCover(): void {
  if (coverFrozenAt === 0) return;
  coverUntil += Date.now() - coverFrozenAt;
  coverFrozenAt = 0;
}

function coverActive(): boolean {
  if (coverFrozenAt !== 0) return coverUntil > coverFrozenAt;
  return Date.now() < coverUntil;
}

function applySnapshot(snapshot: DetectionSnapshot): void {
  noteHotstarLevel();
  if (snapshot.simulated) {
    applySimulated(snapshot);
    return;
  }

  extendCover(snapshot);
  const userPaused = monitor?.isUserPaused() ?? false;
  if (userPaused) freezeCover();
  else thawCover();

  const anchor = monitor?.playerElement() ?? null;
  const action = adBreakAction({
    enabled,
    coverActive: coverActive(),
    hasPlayer: Boolean(anchor),
    userPaused,
  });

  if (action === "show" && anchor) {
    window.clearTimeout(hideTimer);
    if (!countingRealAd) {
      countingRealAd = true;
      adStartedAt = Date.now();
      adCount += 1;
    } else if (adStartedAt == null) {
      adStartedAt = Date.now();
    }
    latest = {
      ...snapshot,
      state: "AD_PLAYING",
      confidence: hasAdSignal(snapshot) ? snapshot.confidence : "high",
      signalId: snapshot.signalId ?? "ad-hold",
      reason: hasAdSignal(snapshot) ? snapshot.reason : "Advertisement still in progress.",
      simulated: false,
    };
    stopSettle();
    forceMute();
    startMuteLoop();
    paintOverlay(anchor);
    startClock();
    publish();
    return;
  }

  if (action === "paused") {
    window.clearTimeout(hideTimer);
    latest = {
      ...snapshot,
      state: "PAUSED",
      reason: "Advertisement is paused.",
    };
    holdOpenAd();
    if (!countingRealAd) {
      countingRealAd = true;
      adCount += 1;
    }
    stopSettle();
    forceMute();
    startMuteLoop();
    startClock();
    overlay.hide();
    publish();
    return;
  }

  window.clearTimeout(hideTimer);
  latest = snapshot;
  finishOpenAd();
  overlay.hide();
  stopClock();
  publish();
}

function applySimulated(snapshot: DetectionSnapshot): void {
  const anchor = monitor?.playerElement() ?? null;
  if (shouldShowOverlay(snapshot, enabled) && anchor) {
    window.clearTimeout(hideTimer);
    finishOpenAd();
    latest = snapshot;
    paintOverlay(anchor);
    startClock();
    publish();
    return;
  }
  window.clearTimeout(hideTimer);
  latest = snapshot;
  overlay.hide();
  stopClock();
  publish();
}

function currentCard(): ContentCard {
  return cardForInterruption(Math.max(0, adCount - 1), feedCards);
}

function paintOverlay(anchor: HTMLElement): void {
  overlay.show(anchor, {
    card: currentCard(),
    elapsedSeconds: elapsedSeconds(),
    remainingSeconds: latest.remainingSeconds,
    simulated: latest.simulated,
  });
}

function elapsedSeconds(): number {
  if (latest.simulated || adStartedAt == null) return latest.simulated ? simulatedElapsed() : 0;
  return Math.floor((Date.now() - adStartedAt) / 1000);
}

let simulatedStartedAt: number | null = null;

function simulatedElapsed(): number {
  if (simulatedStartedAt == null) return 0;
  return Math.floor((Date.now() - simulatedStartedAt) / 1000);
}

function startClock(): void {
  if (clockId) return;
  clockId = window.setInterval(() => {
    if (!latest.simulated && countingRealAd && !coverActive()) {
      latest = {
        ...latest,
        state: "CONTENT_PLAYING",
        confidence: "none",
        signalId: null,
        reason: "Advertisement finished.",
        simulated: false,
      };
      finishOpenAd();
      overlay.hide();
      stopClock();
      publish();
      return;
    }
    forceMute();
    const anchor = monitor?.playerElement();
    if (!anchor || latest.state !== "AD_PLAYING") return;
    overlay.update({
      card: currentCard(),
      elapsedSeconds: latest.simulated ? simulatedElapsed() : elapsedSeconds(),
      remainingSeconds: latest.remainingSeconds,
      simulated: latest.simulated,
    });
    publish();
  }, 250);
}

function stopClock(): void {
  window.clearInterval(clockId);
  clockId = 0;
}

function startMuteLoop(): void {
  if (muteFrame || !countingRealAd) return;
  const loop = (): void => {
    if (!countingRealAd || !enabled) {
      muteFrame = 0;
      return;
    }
    forceMute();
    muteFrame = window.requestAnimationFrame(loop);
  };
  muteFrame = window.requestAnimationFrame(loop);
}

function stopMuteLoop(): void {
  window.cancelAnimationFrame(muteFrame);
  muteFrame = 0;
}

function audibleVideos(): HTMLVideoElement[] {
  const found = new Set<HTMLVideoElement>();
  const player = monitor?.playerElement();
  player?.querySelectorAll("video").forEach((video) => found.add(video));
  document.querySelectorAll("video").forEach((video) => {
    const rect = video.getBoundingClientRect();
    if (rect.width >= 200 && rect.height >= 100) found.add(video);
  });
  return [...found];
}

function isHotstarPage(): boolean {
  return document.getElementById("video-container") != null;
}

function contentVideoElements(): HTMLVideoElement[] {
  return [...document.querySelectorAll("#video-container video")].filter(
    (node): node is HTMLVideoElement => node instanceof HTMLVideoElement,
  );
}

function isShowVideo(video: HTMLVideoElement): boolean {
  return Boolean(video.closest("#video-container")) && !video.closest("#ad-video-container");
}

function noteHotstarLevel(): void {
  if (countingRealAd || settling || !isHotstarPage()) return;
  const video = contentVideoElements().find((candidate) => !candidate.paused && candidate.readyState >= 2);
  if (!video) return;
  if (video.volume === 0 && hotstarLevel && hotstarLevel.volume > 0) return;
  hotstarLevel = { muted: video.muted, volume: video.volume };
}

function writeLevel(video: HTMLVideoElement, level: AudioLevel): void {
  if (video.muted !== level.muted) video.muted = level.muted;
  if (level.muted) video.setAttribute("muted", "");
  else video.removeAttribute("muted");
  if (Math.abs(video.volume - level.volume) > 0.001) video.volume = level.volume;
}

function restoreShowVideo(video: HTMLVideoElement): void {
  writeLevel(video, contentAudioToRestore(hotstarLevel, video.volume));
}

function forceMute(): void {
  if (!countingRealAd || latest.simulated || !enabled) return;
  const videos = audibleVideos();
  const hotstar = isHotstarPage();
  for (const video of videos) {
    if (savedAudio.has(video)) continue;
    const show = hotstar && isShowVideo(video);
    savedAudio.set(video, show && hotstarLevel ? hotstarLevel : { muted: video.muted, volume: video.volume });
  }
  for (const video of videos) {
    if (!video.muted) video.muted = true;
    const keepVolume = hotstar && isShowVideo(video);
    if (!keepVolume && video.volume !== 0) video.volume = 0;
  }
}

function restoreAudio(): void {
  const hotstar = isHotstarPage();
  const showSaved: AudioLevel[] = [];
  for (const [video, previous] of savedAudio) {
    if (hotstar && isShowVideo(video)) {
      showSaved.push(previous);
      continue;
    }
    writeLevel(video, previous);
  }
  savedAudio.clear();
  if (!hotstar) return;
  if (!hotstarLevel) {
    const audible = showSaved.find((level) => level.volume > 0);
    if (audible) hotstarLevel = audible;
  }
  for (const video of contentVideoElements()) restoreShowVideo(video);
}

function stopSettle(): void {
  settling = false;
  window.cancelAnimationFrame(settleFrame);
  settleFrame = 0;
  if (settleGuard) {
    document.removeEventListener("volumechange", settleGuard, true);
    settleGuard = null;
  }
}

function settleHotstarAudio(): void {
  if (!isHotstarPage()) return;
  stopSettle();
  settling = true;
  const started = performance.now();
  const guard = (event: Event): void => {
    if (countingRealAd) return;
    const target = event.target;
    if (!(target instanceof HTMLVideoElement) || !isShowVideo(target)) return;
    const level = contentAudioToRestore(hotstarLevel, target.volume);
    if (target.muted === level.muted && Math.abs(target.volume - level.volume) < 0.001) return;
    writeLevel(target, level);
  };
  settleGuard = guard;
  document.addEventListener("volumechange", guard, true);
  const tick = (): void => {
    if (countingRealAd) {
      stopSettle();
      return;
    }
    for (const video of contentVideoElements()) restoreShowVideo(video);
    if (performance.now() - started < 3000) {
      settleFrame = window.requestAnimationFrame(tick);
      return;
    }
    stopSettle();
  };
  settleFrame = window.requestAnimationFrame(tick);
}

function resetDetection(): void {
  window.clearTimeout(hideTimer);
  finishOpenAd();
  simulated = false;
  simulatedStartedAt = null;
  latest = {
    state: "IDLE",
    confidence: "none",
    signalId: null,
    reason: "Playback changed. Detection reset.",
    remainingSeconds: null,
    simulated: false,
  };
  overlay.hide();
  stopClock();
  monitor?.rescan();
  publish();
}

const installed = globalThis as typeof globalThis & { __adpauseInstalled?: boolean };
if (!installed.__adpauseInstalled) {
  installed.__adpauseInstalled = true;
  boot();
}

function boot(): void {
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;
  if (message.type === "GET_STATUS") {
    sendResponse(currentStatus());
    return true;
  }
  if (message.type === "SET_ENABLED") {
    enabled = message.enabled;
    void chrome.storage.local.set({ [ENABLED_KEY]: enabled });
    window.clearTimeout(hideTimer);
    if (!enabled) {
      finishOpenAd();
      overlay.hide();
      stopClock();
    } else {
      monitor?.rescan();
    }
    publish();
    sendResponse(currentStatus());
    return true;
  }
  if (message.type === "SIMULATE") {
    simulated = message.active;
    simulatedStartedAt = message.active ? Date.now() : null;
    if (!message.active) finishOpenAd();
    monitor?.rescan();
    sendResponse(currentStatus());
    return true;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[FEED_STORAGE_KEY]) {
    feedCards = cardsFromStorage(changes[FEED_STORAGE_KEY].newValue);
  }
  if (!changes[ENABLED_KEY]) return;
  const next = changes[ENABLED_KEY].newValue;
  if (typeof next !== "boolean" || next === enabled) return;
  enabled = next;
  if (!enabled) {
    window.clearTimeout(hideTimer);
    finishOpenAd();
    overlay.hide();
    stopClock();
    publish();
  } else {
    monitor?.rescan();
  }
});

window.addEventListener("pagehide", () => {
  finishOpenAd();
  overlay.destroy();
  monitor?.destroy();
  stopClock();
});

let lastHref = location.href;
window.setInterval(() => {
  noteHotstarLevel();
  if (location.href === lastHref) return;
  lastHref = location.href;
  hotstarLevel = null;
  resetDetection();
}, 400);

void chrome.storage.local.get([ENABLED_KEY, FEED_STORAGE_KEY]).then((stored) => {
  if (typeof stored[ENABLED_KEY] === "boolean") enabled = stored[ENABLED_KEY];
  feedCards = cardsFromStorage(stored[FEED_STORAGE_KEY]);
  monitor = new PlayerMonitor({
    onSnapshot: applySnapshot,
    simulated: () => simulated,
  });
  monitor.start();
  publish();
});
}

function cardsFromStorage(value: unknown): ContentCard[] {
  return isStoredContentFeed(value) ? value.cards : [];
}
