import type { ContentCard, StoredContentFeed } from "../shared/content-card.ts";
import { FEED_STORAGE_KEY } from "../shared/content-card.ts";
import { todayKey } from "./feed-utils.ts";
import { fetchBbcNewsCards } from "./news-feed.ts";
import { fetchWikipediaCards } from "./wikipedia-feed.ts";

const MAX_FEED_CARDS = 12;
const MAX_AGE_MS = 60 * 60 * 1000;

/** Alternate current news with On this day so interruptions feel varied. */
export function mergeFeedCards(
  news: readonly ContentCard[],
  wiki: readonly ContentCard[],
): ContentCard[] {
  const cards: ContentCard[] = [];
  const rounds = Math.max(news.length, wiki.length);
  for (let index = 0; index < rounds; index += 1) {
    const headline = news[index];
    const event = wiki[index];
    if (headline) cards.push(headline);
    if (event) cards.push(event);
    if (cards.length >= MAX_FEED_CARDS) break;
  }
  return cards.slice(0, MAX_FEED_CARDS);
}

export async function refreshContentFeed(date = new Date()): Promise<StoredContentFeed> {
  const [newsResult, wikiResult] = await Promise.allSettled([
    fetchBbcNewsCards(),
    fetchWikipediaCards(date),
  ]);

  const news = newsResult.status === "fulfilled" ? newsResult.value : [];
  const wiki = wikiResult.status === "fulfilled" ? wikiResult.value : [];
  if (newsResult.status === "rejected") {
    console.warn("[AdPause] BBC news refresh failed", newsResult.reason);
  }
  if (wikiResult.status === "rejected") {
    console.warn("[AdPause] Wikipedia refresh failed", wikiResult.reason);
  }

  const cards = mergeFeedCards(news, wiki);
  if (cards.length === 0) {
    throw new Error("No news or Wikipedia cards available");
  }

  const feed: StoredContentFeed = {
    updatedAt: Date.now(),
    dayKey: todayKey(date),
    cards,
  };
  await chrome.storage.local.set({ [FEED_STORAGE_KEY]: feed });
  return feed;
}

export async function ensureContentFeed(): Promise<StoredContentFeed | null> {
  const stored = await chrome.storage.local.get(FEED_STORAGE_KEY);
  const existing = stored[FEED_STORAGE_KEY] as StoredContentFeed | undefined;
  const dayKey = todayKey();
  if (
    existing &&
    existing.dayKey === dayKey &&
    Array.isArray(existing.cards) &&
    existing.cards.length > 0 &&
    Date.now() - existing.updatedAt < MAX_AGE_MS
  ) {
    return existing;
  }
  try {
    return await refreshContentFeed();
  } catch (error) {
    console.warn("[AdPause] Content feed refresh failed", error);
    if (existing && Array.isArray(existing.cards) && existing.cards.length > 0) {
      return existing;
    }
    return null;
  }
}
