chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  void chrome.storage.local.set({ enabled: true });
});
