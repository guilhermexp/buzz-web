import { Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { KIND_NOTE, MAX_TIMELINE_AUTHORS, searchNotes } from "@/features/pulse/lib/pulse-events";
import {
  likedPageLoader,
  notesPageLoader,
  type PageLoader,
} from "@/features/pulse/lib/pulse-queries";
import { useNoteFeed } from "@/features/pulse/lib/use-pulse";
import { PulseComposer } from "@/features/pulse/ui/PulseComposer";
import { PulseEmpty, PulseNoteList } from "@/features/pulse/ui/PulseNoteList";
import { usePulseSession } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

export const PULSE_TABS = ["search", "everyone", "following", "liked", "agents", "mine"] as const;
export type PulseTab = (typeof PULSE_TABS)[number];

type FeedSpec = {
  loader: PageLoader | null;
  live: NostrFilter | null;
  matches: (note: NostrEvent) => boolean;
};

const EMPTY: Record<Exclude<PulseTab, "search">, Parameters<typeof t>[0]> = {
  everyone: "collab.pulse.empty.everyone",
  following: "collab.pulse.empty.following",
  liked: "collab.pulse.empty.liked",
  agents: "collab.pulse.empty.agents",
  mine: "collab.pulse.empty.mine",
};

export function PulseFeedTab({ tab, agentPubkeys }: { tab: PulseTab; agentPubkeys: string[] }) {
  const { client, me, contacts, profile } = usePulseSession();
  const [query, setQuery] = useState("");
  const followKey = contacts.pubkeys.join(",");
  const agentKey = agentPubkeys.join(",");

  const spec = useMemo<FeedSpec>(() => {
    // Desktop bounds multi-author timelines to the first 100 authors.
    const authorsSpec = (all: string[]): FeedSpec => {
      const authors = all.slice(0, MAX_TIMELINE_AUTHORS);
      return authors.length
        ? {
            loader: notesPageLoader(client, authors),
            live: { kinds: [KIND_NOTE], authors },
            matches: (note) => authors.includes(note.pubkey),
          }
        : { loader: null, live: null, matches: () => false };
    };
    switch (tab) {
      case "following":
        return authorsSpec(followKey ? followKey.split(",") : []);
      case "agents":
        return authorsSpec(agentKey ? agentKey.split(",") : []);
      case "mine":
        return authorsSpec([me]);
      case "liked":
        // Liked notes change only through my own likes; the list reloads on revisit.
        return { loader: likedPageLoader(client, me), live: null, matches: () => false };
      default:
        return {
          loader: notesPageLoader(client, null),
          live: { kinds: [KIND_NOTE] },
          matches: () => true,
        };
    }
  }, [tab, client, me, followKey, agentKey]);

  const feed = useNoteFeed({ client, me, ...spec });
  const authorName = useCallback((pubkey: string) => profile(pubkey).name, [profile]);
  const results = useMemo(
    () => (tab === "search" ? searchNotes(feed.notes, query, authorName) : []),
    [tab, feed.notes, query, authorName],
  );

  if (tab === "search") {
    return (
      <div className="flex flex-col gap-5">
        <div className="pt-4 text-center">
          <h3 className="text-xl font-semibold tracking-tight">
            {t("collab.pulse.search.heading")}
          </h3>
        </div>
        <label className="mx-auto flex h-10 w-full max-w-lg items-center gap-2 rounded-full border bg-background px-4 focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            aria-label={t("collab.pulse.tab.search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t("collab.pulse.search.placeholder")}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <p className="text-center text-xs text-muted-foreground">
          {t("collab.pulse.search.scope", { count: feed.notes.length })}
        </p>
        {query.trim() ? (
          <PulseNoteList
            emptyMessage={t("collab.pulse.search.none", { query: query.trim() })}
            feed={feed}
            notes={results}
          />
        ) : feed.hasMore ? (
          <div className="flex justify-center">
            <button
              className="inline-flex h-8 items-center rounded-md border bg-background px-3.5 text-xs font-medium transition-colors hover:bg-foreground/5 disabled:opacity-60"
              disabled={feed.loadingMore || feed.loading}
              type="button"
              onClick={feed.loadMore}
            >
              {feed.loadingMore ? t("collab.pulse.loadingMore") : t("collab.pulse.loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const emptyMessage =
    tab === "agents" && !agentPubkeys.length ? t("collab.pulse.empty.agentsNone") : t(EMPTY[tab]);

  return (
    <div className="flex flex-col gap-4">
      {tab === "liked" || tab === "agents" ? null : <PulseComposer />}
      {tab === "following" && !contacts.loaded ? null : spec.loader ? (
        <PulseNoteList emptyMessage={emptyMessage} feed={feed} />
      ) : (
        <PulseEmpty message={emptyMessage} />
      )}
    </div>
  );
}
