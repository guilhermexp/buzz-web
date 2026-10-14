/**
 * Browser-local sidebar organization: manual order per section and section
 * collapse state, scoped by Relay URL + identity.
 *
 * Buzz Desktop has no manual per-channel order (it syncs only custom sections
 * and an alpha/recent sort mode through kind 30078), so there is no
 * desktop-compatible Relay contract for this order; it intentionally stays in
 * this browser. Stars, mutes and read state keep using the shared Relay
 * user-state lanes.
 */
export const SIDEBAR_SECTIONS = ["starred", "channels", "forums", "dms"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export type SidebarOrganization = {
  order: Record<SidebarSection, string[]>;
  collapsed: Record<SidebarSection, boolean>;
};

const MAX_ORDERED_IDS = 1_000;

export function emptySidebarOrganization(): SidebarOrganization {
  return {
    order: { starred: [], channels: [], forums: [], dms: [] },
    collapsed: { starred: false, channels: false, forums: false, dms: false },
  };
}

export function sidebarOrganizationKey(relayUrl: string, pubkey: string): string {
  return `buzz:web:sidebar-organization:v1:${encodeURIComponent(relayUrl)}:${pubkey.toLowerCase()}`;
}

export function parseSidebarOrganization(raw: string | null): SidebarOrganization {
  const result = emptySidebarOrganization();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "null");
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") return result;
  const value = parsed as { order?: unknown; collapsed?: unknown };
  for (const section of SIDEBAR_SECTIONS) {
    const order = (value.order as Record<string, unknown> | undefined)?.[section];
    if (Array.isArray(order)) {
      result.order[section] = [
        ...new Set(order.filter((id): id is string => typeof id === "string" && id.length > 0)),
      ].slice(0, MAX_ORDERED_IDS);
    }
    const collapsed = (value.collapsed as Record<string, unknown> | undefined)?.[section];
    result.collapsed[section] = collapsed === true;
  }
  return result;
}

/**
 * Sorts a section: ids with a saved position keep that order, others follow
 * by `fallbackCompare` (alphabetical in the UI). New channels therefore never
 * disturb a user's arrangement.
 */
export function orderSection<T>(
  items: readonly T[],
  savedOrder: readonly string[],
  idOf: (item: T) => string,
  fallbackCompare: (left: T, right: T) => number,
): T[] {
  const position = new Map(savedOrder.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftPosition = position.get(idOf(left));
    const rightPosition = position.get(idOf(right));
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return fallbackCompare(left, right);
  });
}

/**
 * Moves `id` by `delta` within the currently displayed order and returns the
 * full order to persist, or null when the move is out of range.
 */
export function moveInSection(
  displayedIds: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const from = displayedIds.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= displayedIds.length) return null;
  const next = [...displayedIds];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
