import { ensureWikipediaFeed, refreshWikipediaFeed } from "./wikipedia-feed.ts";

const FEED_ALARM = "adpause-feed-refresh";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.storage.local.set({ enabled: true });
  }
  void warmFeed();
  void chrome.alarms.create(FEED_ALARM, { periodInMinutes: 360 });
});

chrome.runtime.onStartup.addListener(() => {
  void warmFeed();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FEED_ALARM) return;
  void refreshWikipediaFeed().catch((error) => {
    console.warn("[AdPause] Scheduled feed refresh failed", error);
  });
});

void warmFeed();
void chrome.alarms.create(FEED_ALARM, { periodInMinutes: 360 });

async function warmFeed(): Promise<void> {
  await ensureWikipediaFeed();
}
