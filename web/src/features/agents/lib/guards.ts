/** The agents feature's single structural guard for untrusted JSON (wire payloads, IndexedDB rows). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const HEX_PUBKEY = /^[0-9a-f]{64}$/;
