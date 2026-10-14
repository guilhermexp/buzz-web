/** Narrow parsed Agent Control JSON to an object before reading individual, re-checked fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
