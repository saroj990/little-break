import type { ContentCard, StoredContentFeed } from "../shared/content-card.ts";
import { FEED_STORAGE_KEY } from "../shared/content-card.ts";

const FEED_LIMIT = 8;
const MAX_TEXT = 220;
const MAX_IMAGE_BYTES = 120_000;

interface OnThisDayEvent {
  text?: string;
  year?: number;
  pages?: Array<{
    thumbnail?: { source?: string };
    titles?: { normalized?: string };
  }>;
}

interface OnThisDayResponse {
  selected?: OnThisDayEvent[];
}

export function todayKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function onThisDayUrl(date = new Date()): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${month}/${day}`;
}

export function parseOnThisDay(payload: OnThisDayResponse, date = new Date()): ContentCard[] {
  const events = Array.isArray(payload.selected) ? payload.selected : [];
  const cards: ContentCard[] = [];
  const monthLabel = date.toLocaleString("en", { month: "long" });
  const day = date.getDate();

  for (const event of events) {
    const text = cleanText(event.text);
    if (!text) continue;
    const year = typeof event.year === "number" ? event.year : null;
    const kicker = year != null ? `On this day · ${year}` : `On this day · ${monthLabel} ${day}`;
    cards.push({
      kicker,
      text,
      imageDataUrl: null,
      source: "wikipedia-onthisday",
    });
    if (cards.length >= FEED_LIMIT) break;
  }
  return cards;
}

export async function refreshWikipediaFeed(date = new Date()): Promise<StoredContentFeed> {
  const dayKey = todayKey(date);
  const response = await fetch(onThisDayUrl(date), {
    headers: {
      Accept: "application/json",
      "Api-User-Agent": "AdPause/0.1 (Chrome extension proof of concept)",
    },
  });
  if (!response.ok) {
    throw new Error(`Wikipedia feed failed with ${response.status}`);
  }
  const payload = (await response.json()) as OnThisDayResponse;
  const cards = parseOnThisDay(payload, date);
  if (cards.length === 0) {
    throw new Error("Wikipedia feed returned no usable events");
  }

  const withImages = await Promise.all(
    cards.map(async (card, index) => {
      const event = payload.selected?.[index];
      const imageUrl = event?.pages?.[0]?.thumbnail?.source;
      if (!imageUrl) return card;
      const imageDataUrl = await fetchImageDataUrl(imageUrl);
      return imageDataUrl ? { ...card, imageDataUrl } : card;
    }),
  );

  const feed: StoredContentFeed = {
    updatedAt: Date.now(),
    dayKey,
    cards: withImages,
  };
  await chrome.storage.local.set({ [FEED_STORAGE_KEY]: feed });
  return feed;
}

export async function ensureWikipediaFeed(): Promise<StoredContentFeed | null> {
  const stored = await chrome.storage.local.get(FEED_STORAGE_KEY);
  const existing = stored[FEED_STORAGE_KEY];
  const dayKey = todayKey();
  if (
    existing &&
    typeof existing === "object" &&
    (existing as StoredContentFeed).dayKey === dayKey &&
    Array.isArray((existing as StoredContentFeed).cards) &&
    (existing as StoredContentFeed).cards.length > 0
  ) {
    return existing as StoredContentFeed;
  }
  try {
    return await refreshWikipediaFeed();
  } catch (error) {
    console.warn("[AdPause] Wikipedia feed refresh failed", error);
    return null;
  }
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return null;
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function cleanText(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 24) return null;
  if (text.length <= MAX_TEXT) return text;
  const clipped = text.slice(0, MAX_TEXT - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
