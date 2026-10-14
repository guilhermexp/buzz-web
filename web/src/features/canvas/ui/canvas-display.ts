import { useCallback, useEffect } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { getLocale } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

export function formatCanvasTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    unixSeconds * 1_000,
  );
}

/** Display names for revision authors, loading missing profiles once per author set. */
export function useCanvasAuthorNames(pubkeys: readonly string[]): (pubkey: string) => string {
  const { profiles, ensureProfiles } = useWorkspace();
  const authorKey = [...new Set(pubkeys)].sort().join(",");
  useEffect(() => {
    if (authorKey) void ensureProfiles(authorKey.split(",")).catch(() => undefined);
  }, [authorKey, ensureProfiles]);
  return useCallback(
    (pubkey: string) => profiles[pubkey.toLowerCase()]?.name.trim() || truncatePubkey(pubkey),
    [profiles],
  );
}
