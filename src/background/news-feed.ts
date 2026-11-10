import type { ContentCard } from "../shared/content-card.ts";
import { cleanText, fetchImageDataUrl } from "./feed-utils.ts";

export const BBC_NEWS_RSS_URL = "https://feeds.bbci.co.uk/news/rss.xml";
const NEWS_LIMIT = 8;

interface ParsedNewsItem {
  title: string;
  description: string | null;
  imageUrl: string | null;
}

export function parseBbcRss(xml: string): ContentCard[] {
  return buildNewsCards(collectItems(xml)).map(({ card }) => card);
}

export async function fetchBbcNewsCards(): Promise<ContentCard[]> {
  const response = await fetch(BBC_NEWS_RSS_URL, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "Api-User-Agent": "AdPause/0.1 (Chrome extension proof of concept)",
    },
  });
  if (!response.ok) {
    throw new Error(`BBC news feed failed with ${response.status}`);
  }
  const built = buildNewsCards(collectItems(await response.text()));
  if (built.length === 0) {
    throw new Error("BBC news feed returned no usable headlines");
  }

  return Promise.all(
    built.map(async ({ card, imageUrl }) => {
      if (!imageUrl) return card;
      const imageDataUrl = await fetchImageDataUrl(imageUrl);
      return imageDataUrl ? { ...card, imageDataUrl } : card;
    }),
  );
}

function buildNewsCards(
  items: ParsedNewsItem[],
): Array<{ card: ContentCard; imageUrl: string | null }> {
  const built: Array<{ card: ContentCard; imageUrl: string | null }> = [];
  for (const item of items) {
    const title = cleanText(item.title, 12);
    if (!title) continue;
    const description = item.description ? cleanText(item.description, 20) : null;
    built.push({
      card: {
        kicker: "Current news · BBC",
        text: description && description !== title ? `${title} — ${description}` : title,
        imageDataUrl: null,
        source: "bbc-news",
      },
      imageUrl: item.imageUrl,
    });
    if (built.length >= NEWS_LIMIT) break;
  }
  return built;
}

function collectItems(xml: string): ParsedNewsItem[] {
  const items: ParsedNewsItem[] = [];
  const blocks = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of blocks) {
    const block = match[1] ?? "";
    const title = tagText(block, "title");
    if (!title) continue;
    items.push({
      title,
      description: tagText(block, "description"),
      imageUrl: mediaThumbnail(block),
    });
  }
  return items;
}

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match?.[1]) return null;
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function mediaThumbnail(block: string): string | null {
  const match = block.match(/<media:thumbnail\b[^>]*\burl="([^"]+)"/i);
  return match?.[1] ?? null;
}
