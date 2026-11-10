import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeFeedCards } from "./content-feed.ts";
import { parseBbcRss } from "./news-feed.ts";
import type { ContentCard } from "../shared/content-card.ts";

describe("bbc news feed", () => {
  it("parses BBC RSS headlines into overlay cards", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
        <channel>
          <item>
            <title><![CDATA[Sample headline about world events today]]></title>
            <description><![CDATA[A short summary of the story for the overlay.]]></description>
            <media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/example.jpg"/>
          </item>
          <item>
            <title>Too short</title>
            <description>Nope</description>
          </item>
          <item>
            <title><![CDATA[Another usable headline for AdPause readers]]></title>
            <description><![CDATA[Follow-up detail that can ride with the title.]]></description>
          </item>
        </channel>
      </rss>`;

    const cards = parseBbcRss(xml);
    assert.equal(cards.length, 2);
    assert.equal(cards[0]?.source, "bbc-news");
    assert.equal(cards[0]?.kicker, "Current news · BBC");
    assert.match(cards[0]?.text ?? "", /Sample headline/);
    assert.match(cards[0]?.text ?? "", /short summary/);
    assert.match(cards[1]?.text ?? "", /Another usable headline/);
  });
});

describe("mergeFeedCards", () => {
  it("alternates news and wikipedia cards", () => {
    const news: ContentCard[] = [
      { kicker: "Current news · BBC", text: "News one", source: "bbc-news" },
      { kicker: "Current news · BBC", text: "News two", source: "bbc-news" },
    ];
    const wiki: ContentCard[] = [
      { kicker: "On this day · 1990", text: "Wiki one", source: "wikipedia-onthisday" },
    ];
    const merged = mergeFeedCards(news, wiki);
    assert.deepEqual(
      merged.map((card) => card.text),
      ["News one", "Wiki one", "News two"],
    );
  });
});
