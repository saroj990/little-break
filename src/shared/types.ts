export type PlaybackState =
  | "IDLE"
  | "CONTENT_PLAYING"
  | "AD_PLAYING"
  | "PAUSED"
  | "UNKNOWN";

export type Confidence = "high" | "medium" | "low" | "none";

export interface DetectionSnapshot {
  state: PlaybackState;
  confidence: Confidence;
  signalId: string | null;
  reason: string;
  /** Remaining seconds parsed from ad-timer text, when the text is unambiguous. */
  remainingSeconds: number | null;
  simulated: boolean;
}

export interface SessionStatus {
  enabled: boolean;
  onPrimeVideo: boolean;
  state: PlaybackState;
  confidence: Confidence;
  signalId: string | null;
  reason: string;
  adCount: number;
  adDurationMs: number;
  simulated: boolean;
  updatedAt: number;
}

export interface DiagnosticEntry {
  at: string;
  state: PlaybackState;
  signalId: string | null;
  confidence: Confidence;
  reason: string;
  simulated: boolean;
}
