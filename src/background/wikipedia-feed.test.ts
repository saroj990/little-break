import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onThisDayUrl, parseOnThisDay, todayKey } from "./wikipedia-feed.ts";

describe("wikipedia feed", () => {
  it("builds the selected on-this-day URL for the calendar day", () => {
    const date = new Date(2026, 10, 10);
    assert.equal(todayKey(date), "2026-11-10");
    assert.equal(
      onThisDayUrl(date),
      "https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/11/10",
    );
  });

  it("turns Wikipedia events into short overlay cards", () => {
    const cards = parseOnThisDay(
      {
        selected: [
          {
            year: 1989,
            text: "The Berlin Wall fell, opening checkpoints between East and West Berlin.",
            pages: [{ thumbnail: { source: "https://example.test/wall.jpg" } }],
          },
          {
            year: 1969,
            text: "Short",
          },
          {
            text: "A long enough event without a year still becomes an On this day card for readers.",
          },
        ],
      },
      new Date(2026, 10, 10),
    );

    assert.equal(cards.length, 2);
    assert.equal(cards[0]?.kicker, "On this day · 1989");
    assert.match(cards[0]?.text ?? "", /Berlin Wall/);
    assert.equal(cards[0]?.source, "wikipedia-onthisday");
    assert.equal(cards[1]?.kicker, "On this day · November 10");
  });

  it("clips very long event text", () => {
    const long = "A".repeat(300);
    const [card] = parseOnThisDay({ selected: [{ year: 2001, text: long }] });
    assert.ok(card);
    assert.ok((card.text?.length ?? 0) <= 220);
    assert.match(card.text, /…$/);
  });
});
