import {
  AD_INDICATORS,
  HOTSTAR_AD_CONTAINER_ID,
  HOTSTAR_CONTENT_CONTAINER_ID,
  detect,
  hotstarAdVisible,
  matchesAdCopy,
  parseRemainingSeconds,
  pausedFromControlLabel,
  remainingFromMedia,
  type HotstarMediaProbe,
} from "./ad-detector.ts";
import type { DetectionSnapshot, DiagnosticEntry } from "../shared/types.ts";

const PLAYER_SELECTORS = [
  ".atvwebplayersdk-player-container",
  ".webPlayerSDKContainer",
  "#dv-web-player",
];

const MIN_VIDEO_WIDTH = 320;
const MIN_VIDEO_HEIGHT = 180;
const TIME_JUMP_SECONDS = 15;
const PLAY_PAUSE_BUTTON_ID = "atvwebplayersdk-play-pause-button";

export interface PlayerMonitorOptions {
  onSnapshot: (snapshot: DetectionSnapshot) => void;
  simulated: () => boolean;
}

export class PlayerMonitor {
  private observer: MutationObserver | null = null;
  private observedPlayer: HTMLElement | null = null;
  private pollId = 0;
  private debounceId = 0;
  private lastHref = location.href;
  private lastKey = "";
  private lastRemaining: number | null = null;
  private lastVideoTime: number | null = null;
  private boundVideo: HTMLVideoElement | null = null;
  private userPaused = false;
  private disposed = false;

  constructor(private readonly options: PlayerMonitorOptions) {}

  start(): void {
    this.pollId = window.setInterval(() => this.scan(), 1000);
    window.addEventListener("popstate", this.schedule);
    document.addEventListener("pause", this.onPlayback, true);
    document.addEventListener("play", this.onPlayback, true);
    document.addEventListener("playing", this.onPlayback, true);
    document.addEventListener("click", this.onPlayerControl, true);
    document.addEventListener("keydown", this.onPlayerKey, true);
    this.scan();
  }

  destroy(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.observedPlayer = null;
    this.unbindVideo();
    window.clearInterval(this.pollId);
    window.clearTimeout(this.debounceId);
    window.removeEventListener("popstate", this.schedule);
    document.removeEventListener("pause", this.onPlayback, true);
    document.removeEventListener("play", this.onPlayback, true);
    document.removeEventListener("playing", this.onPlayback, true);
    document.removeEventListener("click", this.onPlayerControl, true);
    document.removeEventListener("keydown", this.onPlayerKey, true);
  }

  rescan(): void {
    this.lastKey = "";
    this.scan();
  }

  playerElement(): HTMLElement | null {
    return findPlayerElement();
  }

  activeVideo(): HTMLVideoElement | null {
    const player = findPlayerElement();
    if (!player) return null;
    return findActiveVideo(player);
  }

  /** True only after the viewer uses the play control or the video itself. */
  isUserPaused(): boolean {
    return this.userPaused;
  }

  private watchPlayer(player: HTMLElement | null): void {
    if (player === this.observedPlayer) return;
    this.observer?.disconnect();
    this.observedPlayer = player;
    if (!player) {
      this.observer = null;
      return;
    }
    this.observer = new MutationObserver((records) => {
      const labelChanged = records.some(
        (record) => record.type === "attributes" && record.attributeName === "aria-label",
      );
      if (labelChanged) this.onPlayback();
      else this.schedule();
    });
    this.observer.observe(player, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
  }

  private onPlayback = (): void => {
    if (this.disposed) return;
    const video = this.activeVideo() ?? this.boundVideo;
    if (video && !video.paused) this.userPaused = false;
    this.scan();
  };

  private onPlayerControl = (event: Event): void => {
    const target = event.target;
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!element) return;
    const player = findPlayerElement();
    const button = element.closest("button");
    const controlLabel = button?.getAttribute("aria-label") ?? button?.getAttribute("title");
    const toggledPlayback =
      Boolean(element.closest(`#${PLAY_PAUSE_BUTTON_ID}`)) ||
      Boolean(element.closest(`#${HOTSTAR_AD_CONTAINER_ID}`)) ||
      (pausedFromControlLabel(controlLabel) !== null && Boolean(player?.contains(element))) ||
      Boolean(
        player &&
          player.contains(element) &&
          (element.closest("video") || element.closest(".atvwebplayersdk-video-surface")),
      );
    if (!toggledPlayback) return;
    this.noteUserGesture();
  };

  private onPlayerKey = (event: KeyboardEvent): void => {
    if (event.code !== "Space") return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
    ) {
      return;
    }
    this.noteUserGesture();
  };

  /** Read pause after the player handles the click. A player-driven pause has no gesture. */
  private noteUserGesture = (): void => {
    const apply = (): void => {
      if (this.disposed) return;
      const video = this.activeVideo() ?? this.boundVideo;
      this.userPaused = Boolean(video?.paused);
      this.lastKey = "";
      this.scan();
    };
    apply();
    window.setTimeout(apply, 50);
  };

  private watchVideo(video: HTMLVideoElement | null): void {
    if (video === this.boundVideo) return;
    this.unbindVideo();
    if (!video) return;
    this.boundVideo = video;
    video.addEventListener("pause", this.onPlayback);
    video.addEventListener("play", this.onPlayback);
    video.addEventListener("playing", this.onPlayback);
  }

  private unbindVideo(): void {
    const video = this.boundVideo;
    if (!video) return;
    video.removeEventListener("pause", this.onPlayback);
    video.removeEventListener("play", this.onPlayback);
    video.removeEventListener("playing", this.onPlayback);
    this.boundVideo = null;
  }

  private schedule = (): void => {
    if (this.disposed) return;
    window.clearTimeout(this.debounceId);
    this.debounceId = window.setTimeout(() => this.scan(), 200);
  };

  private scan(): void {
    if (this.disposed) return;
    if (location.href !== this.lastHref) {
      this.lastHref = location.href;
      this.lastVideoTime = null;
      this.lastKey = "";
    }

    const player = findPlayerElement();
    this.watchPlayer(player);
    const video = player ? findActiveVideo(player) : null;
    this.watchVideo(video);
    const signals = player ? collectSignals(player) : [];

    if (video && this.lastVideoTime != null && !video.paused && !video.seeking) {
      const delta = Math.abs(video.currentTime - this.lastVideoTime);
      if (delta > TIME_JUMP_SECONDS) {
        signals.push({
          id: "time-jump",
          confidence: "low",
          detail: `Playback time moved by ${delta.toFixed(1)}s without an ad UI signal`,
        });
      }
    }
    this.lastVideoTime = video ? video.currentTime : null;

    const remaining = readRemaining(player);
    const snapshot = detect({
      hasPlayerShell: Boolean(player),
      hasActiveVideo: Boolean(video),
      paused: playbackIsPaused(video),
      readyState: video?.readyState ?? 0,
      signals,
      remainingSeconds: remaining,
      simulated: this.options.simulated(),
    });

    const key = [
      snapshot.state,
      snapshot.confidence,
      snapshot.signalId,
      snapshot.reason,
      snapshot.simulated,
    ].join("|");
    const decisionChanged = key !== this.lastKey;
    const remainingChanged = snapshot.remainingSeconds !== this.lastRemaining;
    if (!decisionChanged && !remainingChanged) return;
    this.lastKey = key;
    this.lastRemaining = snapshot.remainingSeconds;
    if (decisionChanged) logDiagnostic(snapshot);
    this.options.onSnapshot(snapshot);
  }
}

export function findPlayerElement(): HTMLElement | null {
  const hotstar = findHotstarPlayer();
  if (hotstar) return hotstar;
  for (const selector of PLAYER_SELECTORS) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) return element;
  }
  return null;
}

function findHotstarPlayer(): HTMLElement | null {
  const content = document.getElementById(HOTSTAR_CONTENT_CONTAINER_ID);
  if (!(content instanceof HTMLElement)) return null;
  const parent = content.parentElement;
  const ad = document.getElementById(HOTSTAR_AD_CONTAINER_ID);
  if (
    parent instanceof HTMLElement &&
    parent !== document.body &&
    parent !== document.documentElement &&
    (ad == null || parent.contains(ad))
  ) {
    return parent;
  }
  return content;
}

function isHotstarShell(player: HTMLElement): boolean {
  return (
    player.id === HOTSTAR_CONTENT_CONTAINER_ID ||
    Boolean(player.querySelector(`#${HOTSTAR_CONTENT_CONTAINER_ID}`))
  );
}

function hotstarAdElement(): HTMLVideoElement | null {
  const video = document.getElementById(HOTSTAR_AD_CONTAINER_ID)?.querySelector("video");
  return video instanceof HTMLVideoElement ? video : null;
}

function probeHotstar(video: HTMLVideoElement): HotstarMediaProbe {
  const rect = video.getBoundingClientRect();
  const onScreen =
    rect.width >= MIN_VIDEO_WIDTH &&
    rect.height >= MIN_VIDEO_HEIGHT &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth;
  return {
    visible: isVisible(video) && onScreen,
    paused: video.paused,
    ended: video.ended,
    currentTime: video.currentTime,
    readyState: video.readyState,
  };
}

function findActiveVideo(player: HTMLElement): HTMLVideoElement | null {
  if (isHotstarShell(player)) {
    const ad = hotstarAdElement();
    if (ad && hotstarAdVisible(probeHotstar(ad))) return ad;
    const content = player.querySelector(`#${HOTSTAR_CONTENT_CONTAINER_ID} video`);
    if (content instanceof HTMLVideoElement && content.getBoundingClientRect().height >= MIN_VIDEO_HEIGHT) {
      return content;
    }
  }
  const videos = [...player.querySelectorAll("video")];
  const visible = videos.filter((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width >= MIN_VIDEO_WIDTH && rect.height >= MIN_VIDEO_HEIGHT;
  });
  if (visible.length === 0) return null;
  return (
    visible.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ??
    null
  );
}

function collectSignals(player: HTMLElement): Array<{
  id: string;
  confidence: "high" | "medium" | "low";
  detail: string;
}> {
  if (isHotstarShell(player)) return collectHotstarSignals();
  const signals: Array<{ id: string; confidence: "high" | "medium" | "low"; detail: string }> = [];

  for (const indicator of AD_INDICATORS) {
    const nodes = player.querySelectorAll(indicator.selector);
    for (const node of nodes) {
      if (!isAttached(node)) continue;
      signals.push({
        id: indicator.id,
        confidence: indicator.confidence,
        detail: `${indicator.description} (${indicator.selector})`,
      });
      break;
    }
  }

  const copy = findAdCopy(player);
  if (copy) {
    signals.push({
      id: "ad-countdown-copy",
      confidence: "medium",
      detail: `Player text matched shipped ad copy: "${copy}"`,
    });
  }

  return signals;
}

function collectHotstarSignals(): Array<{
  id: string;
  confidence: "high" | "medium" | "low";
  detail: string;
}> {
  const video = hotstarAdElement();
  if (!video || !hotstarAdVisible(probeHotstar(video))) return [];
  const content = document.querySelector("#video-container video");
  if (
    content instanceof HTMLVideoElement &&
    !content.paused &&
    content.readyState >= 2 &&
    content.currentTime > 0.25 &&
    (video.paused || video.ended)
  ) {
    return [];
  }
  return [
    {
      id: "ad-video",
      confidence: "high",
      detail: "Hotstar ad video is on screen (#ad-video-container)",
    },
  ];
}

function findAdCopy(player: HTMLElement): string | null {
  const nodes = player.querySelectorAll("span, div, p");
  for (const node of nodes) {
    if (node.childElementCount > 0) continue;
    const text = node.textContent ?? "";
    if (!matchesAdCopy(text)) continue;
    if (!isVisible(node)) continue;
    return text.replace(/\s+/g, " ").trim();
  }
  return null;
}

function readRemaining(player: HTMLElement | null): number | null {
  if (!player) return null;
  if (isHotstarShell(player)) {
    const video = hotstarAdElement();
    if (!video || !hotstarAdVisible(probeHotstar(video))) return null;
    return remainingFromMedia(video.duration, video.currentTime);
  }
  const node = player.querySelector(".atvwebplayersdk-ad-timer-remaining-time");
  if (!(node instanceof HTMLElement) || !isAttached(node)) return null;
  const parsed = parseRemainingSeconds(node.textContent);
  if (parsed != null) return parsed;
  const digits = (node.textContent ?? "").trim().match(/^(\d{1,3})$/);
  if (!digits) return null;
  return Number(digits[1]);
}

function playbackIsPaused(video: HTMLVideoElement | null): boolean {
  // A missing element is not a pause. Ad pods swap the video for a moment,
  // and treating that as paused was hiding the overlay between creatives.
  return Boolean(video?.paused);
}

function isAttached(element: Element): boolean {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  let current: HTMLElement | null = element;
  while (current) {
    if (getComputedStyle(current).display === "none") return false;
    current = current.parentElement;
  }
  return true;
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function logDiagnostic(snapshot: DetectionSnapshot): void {
  const entry: DiagnosticEntry = {
    at: new Date().toISOString(),
    state: snapshot.state,
    signalId: snapshot.signalId,
    confidence: snapshot.confidence,
    reason: snapshot.reason,
    simulated: snapshot.simulated,
  };
  console.info("[AdPause]", entry);
}
