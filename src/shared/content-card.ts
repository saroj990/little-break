export interface ContentCard {
  kicker: string;
  text: string;
  /** Optional inline image so page CSP cannot block Wikimedia hosts. */
  imageDataUrl?: string | null;
  source?: string;
}

export const FEED_STORAGE_KEY = "contentFeed";

export interface StoredContentFeed {
  updatedAt: number;
  dayKey: string;
  cards: ContentCard[];
}

export function isStoredContentFeed(value: unknown): value is StoredContentFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as StoredContentFeed;
  return (
    typeof feed.updatedAt === "number" &&
    typeof feed.dayKey === "string" &&
    Array.isArray(feed.cards) &&
    feed.cards.every(
      (card) =>
        card &&
        typeof card === "object" &&
        typeof card.kicker === "string" &&
        typeof card.text === "string",
    )
  );
}
