import { Loader2, UserCheck, UserPlus } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/features/chat/ui/Avatar";
import { KIND_NOTE } from "@/features/pulse/lib/pulse-events";
import { notesPageLoader } from "@/features/pulse/lib/pulse-queries";
import { useNoteFeed } from "@/features/pulse/lib/use-pulse";
import { PulseNoteList } from "@/features/pulse/ui/PulseNoteList";
import { usePulseSession } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

export function PulseProfileView({ pubkey }: { pubkey: string }) {
  const { client, me, relayUrl, profile, isAgent, contacts } = usePulseSession();
  const [saving, setSaving] = useState(false);
  const person = profile(pubkey);
  const following = contacts.isFollowing(pubkey);
  const self = pubkey === me;
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  const loader = useMemo(() => notesPageLoader(client, [pubkey]), [client, pubkey]);
  const live = useMemo(() => ({ kinds: [KIND_NOTE], authors: [pubkey] }), [pubkey]);
  const matches = useCallback((note: NostrEvent) => note.pubkey === pubkey, [pubkey]);
  const feed = useNoteFeed({ client, loader, live, me, matches });

  const toggleFollow = async () => {
    setSaving(true);
    try {
      await contacts.setFollow(pubkey, !following);
    } catch (error) {
      toast.error(t("collab.pulse.error.follow"), {
        description: error instanceof Error ? error.message.slice(0, 200) : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("collab.pulse.profile.title")} className="flex items-start gap-4">
        <Avatar profile={{ ...person, isAgent: isAgent(pubkey) }} relayUrl={relayUrl} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="min-w-0 truncate text-lg font-semibold tracking-tight">{person.name}</h3>
            {self ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t("collab.pulse.you")}
              </span>
            ) : (
              <button
                aria-pressed={following}
                className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-60 ${
                  following
                    ? "border bg-background hover:bg-foreground/5"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
                disabled={saving || !contacts.loaded}
                type="button"
                onClick={() => void toggleFollow()}
              >
                {saving ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : following ? (
                  <UserCheck aria-hidden className="h-3.5 w-3.5" />
                ) : (
                  <UserPlus aria-hidden className="h-3.5 w-3.5" />
                )}
                {following ? t("collab.pulse.profile.unfollow") : t("collab.pulse.profile.follow")}
              </button>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={npub}>
            {truncatePubkey(npub)}
          </p>
          {person.about ? (
            <p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm text-foreground/85">
              {person.about}
            </p>
          ) : null}
        </div>
      </section>
      <section aria-label={t("collab.pulse.profile.notes")}>
        <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
          {t("collab.pulse.profile.notes")}
        </h4>
        <PulseNoteList emptyMessage={t("collab.pulse.profile.empty")} feed={feed} />
      </section>
    </div>
  );
}
