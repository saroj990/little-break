import type { SessionStatus } from "./types.ts";

export type ExtensionMessage =
  | { type: "GET_STATUS" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "SIMULATE"; active: boolean }
  | { type: "STATUS"; status: SessionStatus };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "GET_STATUS" ||
    type === "SET_ENABLED" ||
    type === "SIMULATE" ||
    type === "STATUS"
  );
}
