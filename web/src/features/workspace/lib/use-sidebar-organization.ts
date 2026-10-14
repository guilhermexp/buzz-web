import { useCallback, useEffect, useMemo, useState } from "react";
import {
  moveInSection,
  parseSidebarOrganization,
  type SidebarOrganization,
  type SidebarSection,
  sidebarOrganizationKey,
} from "@/features/workspace/lib/sidebar-organization";

export function useSidebarOrganization(relayUrl: string, pubkey: string) {
  const storageKey = useMemo(() => sidebarOrganizationKey(relayUrl, pubkey), [pubkey, relayUrl]);
  const [organization, setOrganization] = useState<SidebarOrganization>(() =>
    parseSidebarOrganization(readKey(storageKey)),
  );

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(organization));
    } catch {
      // Storage may be blocked; the arrangement still applies to this tab.
    }
  }, [organization, storageKey]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setOrganization(parseSidebarOrganization(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const toggleCollapsed = useCallback((section: SidebarSection) => {
    setOrganization((current) => ({
      ...current,
      collapsed: { ...current.collapsed, [section]: !current.collapsed[section] },
    }));
  }, []);

  /** Returns false when the item is already at that edge. */
  const move = useCallback(
    (section: SidebarSection, displayedIds: readonly string[], id: string, delta: -1 | 1) => {
      const next = moveInSection(displayedIds, id, delta);
      if (!next) return false;
      setOrganization((current) => ({ ...current, order: { ...current.order, [section]: next } }));
      return true;
    },
    [],
  );

  return { organization, toggleCollapsed, move };
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
