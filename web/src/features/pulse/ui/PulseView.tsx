import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fallbackProfile } from "@/features/chat/lib/chat-model";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { ComposerMentionCandidate } from "@/features/chat/ui/MentionAutocomplete";
import { buildNoteTemplate, type NoteExtras } from "@/features/pulse/lib/pulse-events";
import { useContacts } from "@/features/pulse/lib/use-pulse";
import { PULSE_TABS, PulseFeedTab, type PulseTab } from "@/features/pulse/ui/PulseFeedTab";
import { PulseProfileView } from "@/features/pulse/ui/PulseProfileView";
import { PulseThreadView } from "@/features/pulse/ui/PulseThreadView";
import { type PulseSession, PulseSessionContext } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

type Route = { type: "profile"; pubkey: string } | { type: "thread"; noteId: string };

const TAB_LABEL: Record<PulseTab, Parameters<typeof t>[0]> = {
  search: "collab.pulse.tab.search",
  everyone: "collab.pulse.tab.everyone",
  following: "collab.pulse.tab.following",
  liked: "collab.pulse.tab.liked",
  agents: "collab.pulse.tab.agents",
  mine: "collab.pulse.tab.mine",
};

/** Desktop-compatible Pulse: global kind 1 notes, distinct from (and never touching) Inbox. */
export function PulseView({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace();
  const { client, demo, pubkey: me, relayUrl, profiles, channels, ensureProfiles } = workspace;
  const queryClient = useQueryClient();
  const contacts = useContacts(client, me);
  const [tab, setTab] = useState<PulseTab>("everyone");
  const [stack, setStack] = useState<Route[]>([]);
  const listeners = useRef(new Set<(note: NostrEvent) => void>());
  const tabRefs = useRef<Partial<Record<PulseTab, HTMLButtonElement | null>>>({});
  const route = stack[stack.length - 1] ?? null;

  const agentPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const channel of channels) {
      for (const member of channel.members) if (member.role === "bot") set.add(member.pubkey);
    }
    for (const profile of Object.values(profiles)) if (profile.isAgent) set.add(profile.pubkey);
    return [...set].sort();
  }, [channels, profiles]);

  // Desktop's Pulse mention set: me, my follows and agents. Names come from kind 0.
  const mentionPubkeys = useMemo(
    () => [...new Set([me, ...contacts.pubkeys, ...agentPubkeys].map((key) => key.toLowerCase()))],
    [me, contacts.pubkeys, agentPubkeys],
  );
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const missing = mentionPubkeys.filter((key) => !profiles[key] && !requested.current.has(key));
    for (const key of missing) requested.current.add(key);
    if (missing.length) void ensureProfiles(missing);
  }, [mentionPubkeys, profiles, ensureProfiles]);
  const mentionCandidates = useMemo<ComposerMentionCandidate[]>(
    () =>
      mentionPubkeys.flatMap((key) => {
        const profile = profiles[key];
        if (!profile?.name.trim()) return [];
        const agent = agentPubkeys.includes(key);
        return [
          {
            pubkey: key,
            profile: { ...profile, isAgent: agent || profile.isAgent },
            role: agent ? ("bot" as const) : ("member" as const),
          },
        ];
      }),
    [mentionPubkeys, profiles, agentPubkeys],
  );

  const onPublished = useCallback((listener: (note: NostrEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const publishNote = useCallback(
    async (content: string, extras?: NoteExtras) => {
      if (!client) throw new Error(t("error.relayClient"));
      const { event } = await client.publish(buildNoteTemplate(content, extras));
      queryClient.setQueryData(["pulse-note", relayUrl, me, event.id], event);
      for (const listener of listeners.current) listener(event);
      return event;
    },
    [client, queryClient, relayUrl, me],
  );
  const session = useMemo<PulseSession | null>(() => {
    if (!client) return null;
    return {
      client,
      me,
      relayUrl,
      contacts,
      profile: (pubkey) => {
        const key = pubkey.toLowerCase();
        const known = profiles[key];
        // Resolve unknown authors once; the fallback name shows until kind 0 arrives.
        if (!known && !requested.current.has(key)) {
          requested.current.add(key);
          queueMicrotask(() => void ensureProfiles([key]));
        }
        return known ?? fallbackProfile(key);
      },
      isAgent: (pubkey) => agentPubkeys.includes(pubkey.toLowerCase()),
      mentionCandidates,
      openProfile: (pubkey) => setStack((current) => [...current, { type: "profile", pubkey }]),
      openThread: (noteId) => setStack((current) => [...current, { type: "thread", noteId }]),
      publishNote,
      onPublished,
    };
  }, [
    client,
    me,
    relayUrl,
    contacts,
    profiles,
    ensureProfiles,
    agentPubkeys,
    publishNote,
    onPublished,
    mentionCandidates,
  ]);

  const onTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const index = PULSE_TABS.indexOf(tab);
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = PULSE_TABS[(index + step + PULSE_TABS.length) % PULSE_TABS.length];
      setTab(next);
      tabRefs.current[next]?.focus();
    },
    [tab],
  );

  const title = route
    ? route.type === "profile"
      ? t("collab.pulse.profile.title")
      : t("collab.pulse.thread.title")
    : t("collab.pulse.title");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {route ? (
          <button
            aria-label={t("collab.pulse.back")}
            className="buzz-icon-button h-7 w-7 flex-none"
            title={t("collab.pulse.back")}
            type="button"
            onClick={() => setStack((current) => current.slice(0, -1))}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <button
          aria-label={t("collab.pulse.close")}
          className="buzz-icon-button h-7 w-7 flex-none"
          title={t("collab.pulse.close")}
          type="button"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {!session || demo ? (
        <div className="mx-auto mt-16 max-w-sm px-6 text-center text-sm text-muted-foreground">
          {t("collab.pulse.offline")}
        </div>
      ) : (
        <PulseSessionContext.Provider value={session}>
          {route ? null : (
            <div className="shrink-0 border-b px-3 py-2">
              <div
                aria-label={t("collab.pulse.sections")}
                className="mx-auto flex w-full max-w-2xl items-center gap-1 overflow-x-auto [scrollbar-width:none]"
                role="tablist"
              >
                {PULSE_TABS.map((item) => (
                  <button
                    aria-controls={`pulse-panel-${item}`}
                    aria-label={item === "search" ? t(TAB_LABEL[item]) : undefined}
                    aria-selected={tab === item}
                    className={`inline-flex h-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                      tab === item
                        ? "border-border bg-background text-foreground shadow-xs"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    } ${item === "search" ? "w-7" : "px-2.5"}`}
                    id={`pulse-tab-${item}`}
                    key={item}
                    ref={(node) => {
                      tabRefs.current[item] = node;
                    }}
                    role="tab"
                    tabIndex={tab === item ? 0 : -1}
                    title={item === "search" ? t(TAB_LABEL[item]) : undefined}
                    type="button"
                    onClick={() => setTab(item)}
                    onKeyDown={onTabKeyDown}
                  >
                    {item === "search" ? (
                      <Search aria-hidden className="h-4 w-4 shrink-0" />
                    ) : (
                      t(TAB_LABEL[item])
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5 sm:px-6">
              {route?.type === "profile" ? (
                <PulseProfileView key={`profile-${route.pubkey}`} pubkey={route.pubkey} />
              ) : route?.type === "thread" ? (
                <PulseThreadView key={`thread-${route.noteId}`} noteId={route.noteId} />
              ) : null}
              <div
                aria-labelledby={`pulse-tab-${tab}`}
                hidden={route !== null}
                id={`pulse-panel-${tab}`}
                role="tabpanel"
              >
                <PulseFeedTab agentPubkeys={agentPubkeys} key={tab} tab={tab} />
              </div>
            </div>
          </div>
        </PulseSessionContext.Provider>
      )}
    </div>
  );
}
