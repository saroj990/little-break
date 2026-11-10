import type { ContentCard } from "../shared/content-card.ts";
import { cleanText, fetchImageDataUrl, todayKey } from "./feed-utils.ts";

export { todayKey };

const FEED_LIMIT = 8;

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

export async function fetchWikipediaCards(date = new Date()): Promise<ContentCard[]> {
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

  return Promise.all(
    cards.map(async (card, index) => {
      const imageUrl = payload.selected?.[index]?.pages?.[0]?.thumbnail?.source;
      if (!imageUrl) return card;
      const imageDataUrl = await fetchImageDataUrl(imageUrl);
      return imageDataUrl ? { ...card, imageDataUrl } : card;
    }),
  );
}
