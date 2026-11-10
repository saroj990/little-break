import overlayCss from "../styles/overlay.css?inline";
import type { ContentCard } from "../shared/content-card.ts";

const HOST_ID = "adpause-host";

export interface OverlayContent {
  card: ContentCard;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  simulated: boolean;
}

/**
 * Covers the video picture. The host is attached outside the player so a
 * later video layer cannot paint the advertisement over the card.
 */
export class OverlayManager {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private anchor: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  show(anchor: HTMLElement, content: OverlayContent): void {
    this.anchor = anchor;
    const parent = this.parentFor(anchor);
    if (!this.host?.isConnected || this.host.parentElement !== parent) {
      this.mount(parent);
    }
    this.render(content);
    this.place();
    this.watch();
  }

  update(content: OverlayContent): void {
    if (!this.anchor) return;
    if (!this.host?.isConnected) {
      this.show(this.anchor, content);
      return;
    }
    this.render(content);
    this.place();
  }

  hide(): void {
    this.unwatch();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.anchor = null;
  }

  isMounted(): boolean {
    return Boolean(this.host?.isConnected);
  }

  destroy(): void {
    this.hide();
  }

  private parentFor(anchor: HTMLElement): HTMLElement {
    const fullscreen = document.fullscreenElement;
    if (
      fullscreen instanceof HTMLElement &&
      !(fullscreen instanceof HTMLVideoElement) &&
      (fullscreen === anchor || fullscreen.contains(anchor) || anchor.contains(fullscreen))
    ) {
      return fullscreen;
    }
    return document.documentElement;
  }

  private coverTarget(anchor: HTMLElement): HTMLElement {
    const ad = document.getElementById("ad-video-container")?.querySelector("video");
    if (ad instanceof HTMLElement && this.boxIsOnScreen(ad)) return ad;
    const surface = anchor.querySelector(".atvwebplayersdk-video-surface");
    if (surface instanceof HTMLElement && surface.getBoundingClientRect().height >= 80) return surface;
    const video = [...anchor.querySelectorAll("video")].find((candidate) => candidate.getBoundingClientRect().height >= 80);
    if (video instanceof HTMLElement) return video;
    return anchor;
  }

  private boxIsOnScreen(element: HTMLElement): boolean {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width >= 80 && rect.height >= 80;
  }

  private mount(parent: HTMLElement): void {
    this.host?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-adpause", "overlay");
    host.style.position = "absolute";
    host.style.zIndex = "2147483646";
    host.style.setProperty("z-index", "2147483646", "important");
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = overlayCss;
    shadow.appendChild(style);
    shadow.appendChild(document.createElement("div"));
    parent.appendChild(host);
    this.host = host;
    this.shadow = shadow;
  }

  private render(content: OverlayContent): void {
    const root = this.shadow?.querySelector("div");
    if (!root) return;
    const fact = content.card;
    root.className = "adpause-overlay";
    root.replaceChildren();

    const card = document.createElement("div");
    card.className = "adpause-card";

    const brand = document.createElement("p");
    brand.className = "adpause-brand";
    brand.textContent = "AdPause";

    const heading = document.createElement("h1");
    heading.className = "adpause-heading";
    heading.textContent = "A little break!";

    const kicker = document.createElement("p");
    kicker.className = "adpause-kicker";
    kicker.textContent = fact.kicker;

    if (fact.imageDataUrl) {
      const media = document.createElement("div");
      media.className = "adpause-media";
      const image = document.createElement("img");
      image.className = "adpause-image";
      image.alt = "";
      image.decoding = "async";
      image.src = fact.imageDataUrl;
      media.append(image);
      card.append(brand, heading, media, kicker);
    } else {
      card.append(brand, heading, kicker);
    }

    const factText = document.createElement("p");
    factText.className = "adpause-fact";
    factText.textContent = fact.text;

    const meta = document.createElement("div");
    meta.className = "adpause-meta";

    const live = document.createElement("span");
    live.className = "adpause-live";
    const dot = document.createElement("i");
    const liveText = document.createElement("span");
    liveText.textContent =
      fact.source === "wikipedia-onthisday" ? "Wikipedia · On this day" : "Monitoring playback";
    live.append(dot, liveText);

    const time = document.createElement("span");
    time.textContent = formatTiming(content.elapsedSeconds, content.remainingSeconds);

    meta.append(live, time);
    card.append(factText, meta);

    if (content.simulated) {
      const sim = document.createElement("p");
      sim.className = "adpause-sim";
      sim.textContent = "Diagnostic simulation. This is not a real advertisement.";
      card.append(sim);
    }

    root.append(card);
  }

  private place = (): void => {
    const host = this.host;
    const anchor = this.anchor;
    if (!host || !anchor) return;

    const parent = this.parentFor(anchor);
    // Re-appending a node that is already in place detaches it for a frame
    // and lets the advertisement show through.
    if (host.parentElement !== parent || parent.lastElementChild !== host) {
      parent.appendChild(host);
    }

    const rect = this.coverTarget(anchor).getBoundingClientRect();
    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLElement && parent === fullscreen && parent !== document.documentElement) {
      const parentRect = parent.getBoundingClientRect();
      host.style.position = "fixed";
      host.style.left = `${rect.left - parentRect.left}px`;
      host.style.top = `${rect.top - parentRect.top}px`;
    } else {
      host.style.position = "fixed";
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
    }
    host.style.width = `${Math.max(rect.width, 0)}px`;
    host.style.height = `${Math.max(rect.height, 0)}px`;
    host.style.setProperty("z-index", "2147483646", "important");
  };

  private watch(): void {
    this.unwatch();
    this.resizeObserver = new ResizeObserver(() => this.place());
    this.resizeObserver.observe(this.anchor ?? document.documentElement);
    window.addEventListener("resize", this.place);
    window.addEventListener("scroll", this.place, true);
    document.addEventListener("fullscreenchange", this.place);
  }

  private unwatch(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.place);
    window.removeEventListener("scroll", this.place, true);
    document.removeEventListener("fullscreenchange", this.place);
  }
}

function formatTiming(elapsedSeconds: number, remainingSeconds: number | null): string {
  const elapsed = formatClock(elapsedSeconds);
  if (remainingSeconds == null) return elapsed;
  return `${elapsed} · ${formatClock(remainingSeconds)} left`;
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
