import type { ContentCard } from "../shared/content-card.ts";

export type { ContentCard };

export const SAMPLE_FACTS: readonly ContentCard[] = [
  {
    kicker: "Did you know?",
    text: "Octopuses have three hearts, and two of them stop beating when they swim.",
    source: "local",
  },
  {
    kicker: "Did you know?",
    text: "Honey never spoils. Sealed jars found in Egyptian tombs were still edible thousands of years later.",
    source: "local",
  },
  {
    kicker: "Did you know?",
    text: "A day on Venus is longer than a year on Venus. It rotates once every 243 Earth days.",
    source: "local",
  },
  {
    kicker: "Did you know?",
    text: "Sea otters hold hands while they sleep so they do not drift apart.",
    source: "local",
  },
  {
    kicker: "Did you know?",
    text: "Bananas are berries, and strawberries are not.",
    source: "local",
  },
];

/** Prefer the live feed; fall back to the local facts when offline. */
export function cardForInterruption(
  index: number,
  feed: readonly ContentCard[] = [],
): ContentCard {
  const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  if (feed.length > 0) {
    return feed[safe % feed.length] ?? feed[0]!;
  }
  return SAMPLE_FACTS[safe % SAMPLE_FACTS.length] ?? SAMPLE_FACTS[0]!;
}

/** @deprecated Use cardForInterruption. Kept for older call sites. */
export function factForInterruption(index: number): ContentCard {
  return cardForInterruption(index);
}
