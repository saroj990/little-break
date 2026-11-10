export interface FactCard {
  kicker: string;
  text: string;
}

export const SAMPLE_FACTS: readonly FactCard[] = [
  {
    kicker: "Did you know?",
    text: "Octopuses have three hearts, and two of them stop beating when they swim.",
  },
  {
    kicker: "Did you know?",
    text: "Honey never spoils. Sealed jars found in Egyptian tombs were still edible thousands of years later.",
  },
  {
    kicker: "Did you know?",
    text: "A day on Venus is longer than a year on Venus. It rotates once every 243 Earth days.",
  },
  {
    kicker: "Did you know?",
    text: "Sea otters hold hands while they sleep so they do not drift apart.",
  },
  {
    kicker: "Did you know?",
    text: "Bananas are berries, and strawberries are not.",
  },
];

export function factForInterruption(index: number): FactCard {
  const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return SAMPLE_FACTS[safe % SAMPLE_FACTS.length] ?? SAMPLE_FACTS[0];
}
