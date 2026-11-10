import { useCallback, useEffect, useState } from "react";
import type { SessionStatus } from "../shared/types.ts";

const EMPTY: SessionStatus = {
  enabled: true,
  onPrimeVideo: false,
  state: "IDLE",
  confidence: "none",
  signalId: null,
  reason: "Open Prime Video or Hotstar and start playback.",
  adCount: 0,
  adDurationMs: 0,
  simulated: false,
  updatedAt: 0,
};

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === "primevideo.com" || host.endsWith(".primevideo.com")) return true;
    if (host === "hotstar.com" || host.endsWith(".hotstar.com")) return true;
    if (host === "jiohotstar.com" || host.endsWith(".jiohotstar.com")) return true;
    return /(^|\.)amazon\./.test(host) && /\/gp\/video|\/video\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isStatus(value: unknown): value is SessionStatus {
  return Boolean(value && typeof value === "object" && "state" in value);
}

async function askTab(tabId: number): Promise<SessionStatus | null> {
  try {
    const response: unknown = await chrome.tabs.sendMessage(tabId, { type: "GET_STATUS" });
    return isStatus(response) ? response : null;
  } catch {
    return null;
  }
}

export function App() {
  const [status, setStatus] = useState<SessionStatus>(EMPTY);
  const [tabReady, setTabReady] = useState(false);
  const [watchPage, setWatchPage] = useState(false);

  const refresh = useCallback(async () => {
    const stored = await chrome.storage.local.get("enabled");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const supported = isSupportedUrl(tab?.url);
    setWatchPage(supported);

    let live: SessionStatus | null = null;
    if (tab?.id != null && supported) {
      live = await askTab(tab.id);
      if (!live) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
          live = await askTab(tab.id);
        } catch {
          live = null;
        }
      }
    }

    setTabReady(Boolean(live));
    setStatus({
      ...(live ?? EMPTY),
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : true,
      onPrimeVideo: Boolean(live),
    });
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = (): void => {
      void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  async function setEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ enabled });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled });
    } catch {
      /* Content script is not on this tab. */
    }
    await refresh();
  }

  async function simulate(active: boolean): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "SIMULATE", active });
      await refresh();
    } catch {
      setTabReady(false);
    }
  }

  return (
    <main className="popup">
      <header>
        <p className="brand">AdPause</p>
        <h1>A little break</h1>
      </header>

      <label className="toggle">
        <input
          type="checkbox"
          checked={status.enabled}
          onChange={(event) => void setEnabled(event.target.checked)}
        />
        <span>{status.enabled ? "Enabled" : "Disabled"}</span>
      </label>

      <dl>
        <div>
          <dt>Status</dt>
          <dd>{tabReady ? labelFor(status) : watchPage ? "On this page" : "Not on Prime Video or Hotstar"}</dd>
        </div>
        <div>
          <dt>Signal</dt>
          <dd>{tabReady ? (status.signalId ?? "None") : watchPage ? "Waiting" : "—"}</dd>
        </div>
        <div>
          <dt>Interruptions</dt>
          <dd>{status.adCount}</dd>
        </div>
        <div>
          <dt>Interruption time</dt>
          <dd>{formatDuration(status.adDurationMs)}</dd>
        </div>
      </dl>

      <p className="reason">
        {tabReady
          ? status.reason
          : watchPage
            ? "This tab has not connected yet. Reload it, then open AdPause again."
            : EMPTY.reason}
      </p>

      <div className="actions">
        <button type="button" disabled={!tabReady || status.simulated} onClick={() => void simulate(true)}>
          Simulate ad
        </button>
        <button type="button" disabled={!tabReady || !status.simulated} onClick={() => void simulate(false)}>
          End simulation
        </button>
      </div>

      <a
        href="#"
        onClick={(event) => {
          event.preventDefault();
          void chrome.tabs.create({ url: chrome.runtime.getURL("about.html") });
        }}
      >
        Project information
      </a>
    </main>
  );
}

function labelFor(status: SessionStatus): string {
  if (status.simulated) return "Simulated ad";
  switch (status.state) {
    case "AD_PLAYING":
      return "Advertisement";
    case "CONTENT_PLAYING":
      return "Playing";
    case "PAUSED":
      return "Paused";
    case "UNKNOWN":
      return "Unknown";
    default:
      return "In the player";
  }
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
