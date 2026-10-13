import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDiscoveredChannels,
  membershipQueryChannelIds,
  metadataChannelIdsMissingFrom,
} from "@/features/chat/lib/channel-discovery";
import {
  AUXILIARY_KINDS,
  buildTimeline,
  fallbackProfile,
  parseCommunityRole,
  profilesFromEvents,
  systemMessagePubkeys,
  TIMELINE_KINDS,
} from "@/features/chat/lib/chat-model";
import type {
  BuzzChannel,
  SearchHit,
  SessionState,
  UserProfile,
} from "@/features/chat/lib/chat-types";
import {
  demoEvent,
  demoSystemEvent,
  eventChannelId,
  mergeEvents,
  presenceSubject,
  profileSeed,
  validPresence,
} from "@/features/chat/lib/session-events";
import { type ReplyTarget, useSessionMutations } from "@/features/chat/lib/use-session-mutations";
import {
  applyPendingRoles,
  freshestRosters,
  type PendingRoleChange,
  settlePendingRoles,
} from "@/features/workspace/lib/roster-merge";
import type { NostrEvent, RelayConnectionState } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import type { RuntimeConfig } from "@/shared/config/runtime-config";
import { t } from "@/shared/i18n";

type MessageAnchor = {
  channelId: string;
  eventId: string;
  threadRootId: string | null;
};

export function useBuzzSession({
  client,
  config,
  pubkey,
  demo,
}: {
  client: BuzzRelayClient | null;
  config: RuntimeConfig;
  pubkey: string;
  demo: boolean;
}) {
  const [connectionState, setConnectionState] = useState<RelayConnectionState>(
    demo ? "connected" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<BuzzChannel[]>([]);
  const [discoveredChannels, setDiscoveredChannels] = useState<BuzzChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messageAnchor, setMessageAnchor] = useState<MessageAnchor | null>(null);
  const [contentEvents, setContentEvents] = useState<NostrEvent[]>([]);
  const [auxiliaryEvents, setAuxiliaryEvents] = useState<NostrEvent[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>(() =>
    profileSeed(config, pubkey),
  );
  const [presence, setPresence] = useState<Record<string, "online" | "away" | "offline">>({});
  const [typingExpiry, setTypingExpiry] = useState<Record<string, number>>({});
  const [communityRole, setCommunityRole] = useState<SessionState["communityRole"]>(
    demo ? "owner" : null,
  );
  const [loadingChannels, setLoadingChannels] = useState(!demo);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [delivery, setDelivery] = useState<Record<string, "sending" | "failed">>({});
  const typingSentAt = useRef(0);
  const presenceUpdatedAt = useRef<Record<string, number>>({});
  const rosterCache = useRef(new Map<string, NostrEvent>());
  const [rosterVersions, setRosterVersions] = useState<Record<string, number>>({});
  const [pendingRoles, setPendingRoles] = useState<PendingRoleChange[]>([]);
  const mountedRef = useRef(true);
  const agentPubkeys = useMemo(
    () => new Set(config.agents.map((agent) => agent.pubkey.toLowerCase())),
    [config.agents],
  );

  const loadProfiles = useCallback(
    async (pubkeys: string[]) => {
      if (!client || demo) return;
      const unique = [...new Set(pubkeys.map((value) => value.toLowerCase()))].filter((value) =>
        /^[0-9a-f]{64}$/.test(value),
      );
      if (!unique.length) return;
      const events = await client.query({ kinds: [0], authors: unique, limit: unique.length });
      const parsed = profilesFromEvents(events, agentPubkeys);
      setProfiles((current) => {
        const next = { ...current, ...parsed };
        for (const candidate of unique) {
          next[candidate] ??= fallbackProfile(candidate);
        }
        for (const agent of config.agents) {
          const existing = next[agent.pubkey] ?? fallbackProfile(agent.pubkey, agent.name, true);
          next[agent.pubkey] = {
            ...existing,
            name: parsed[agent.pubkey]?.name || agent.name,
            isAgent: true,
          };
        }
        return next;
      });
    },
    [agentPubkeys, client, config.agents, demo],
  );

  const applyPresenceEvents = useCallback(
    (events: NostrEvent[], replaceSubjects: string[] = []) => {
      const now = Date.now();
      setPresence((current) => {
        const next = { ...current };
        for (const subject of replaceSubjects) {
          const normalized = subject.toLowerCase();
          next[normalized] = "offline";
          delete presenceUpdatedAt.current[normalized];
        }
        for (const event of events) {
          if (!validPresence(event.content)) continue;
          const subject = presenceSubject(event);
          next[subject] = event.content;
          presenceUpdatedAt.current[subject] = now;
        }
        return next;
      });
    },
    [],
  );

  const loadChannels = useCallback(async () => {
    if (!client || demo) return;
    setLoadingChannels(true);
    try {
      const [ownMemberEvents, metadataEvents, roleEvents] = await Promise.all([
        client.query({ kinds: [39002], "#p": [pubkey], limit: 500 }),
        client.query({ kinds: [39000], limit: 1_000 }),
        client.query({ kinds: [13534], limit: 1 }),
      ]);
      const ownRosters = freshestRosters(rosterCache.current, ownMemberEvents);
      const missingOwnMetadataIds = metadataChannelIdsMissingFrom(metadataEvents, ownRosters);
      const membershipVisibleIds = membershipQueryChannelIds(metadataEvents, ownRosters);
      const [visibleMemberEvents, missingMetadataEvents] = await Promise.all([
        membershipVisibleIds.length
          ? client.query({ kinds: [39002], "#d": membershipVisibleIds, limit: 1_000 })
          : Promise.resolve([]),
        missingOwnMetadataIds.length
          ? client.query({ kinds: [39000], "#d": missingOwnMetadataIds, limit: 500 })
          : Promise.resolve([]),
      ]);
      const visibleRosters = freshestRosters(rosterCache.current, visibleMemberEvents);
      setRosterVersions((current) => {
        const next = { ...current };
        for (const roster of [...ownRosters, ...visibleRosters]) {
          const channelId = roster.tags.find((tag) => tag[0] === "d")?.[1];
          if (channelId) next[channelId] = roster.created_at;
        }
        return next;
      });
      const nextDiscovered = buildDiscoveredChannels({
        metadataEvents: mergeEvents(metadataEvents, missingMetadataEvents),
        memberEvents: visibleRosters,
        ownMemberEvents: ownRosters,
        currentPubkey: pubkey,
      });
      const nextChannels = nextDiscovered.filter(
        (channel) => channel.isMember && !channel.archived,
      );
      setDiscoveredChannels(nextDiscovered);
      setChannels(nextChannels);
      setSelectedChannelId((current) =>
        current && nextChannels.some((channel) => channel.id === current)
          ? current
          : (nextChannels.find((channel) => channel.name === "general")?.id ??
            nextChannels[0]?.id ??
            null),
      );
      setCommunityRole(parseCommunityRole(roleEvents[0], pubkey));
      const profilePubkeys = [
        pubkey,
        ...config.agents.map((agent) => agent.pubkey),
        ...nextDiscovered.flatMap((channel) => channel.members.map((member) => member.pubkey)),
      ];
      await Promise.all([
        loadProfiles(profilePubkeys),
        client
          .queryHttp([
            {
              kinds: [40902],
              authors: [...new Set(profilePubkeys.map((value) => value.toLowerCase()))],
              limit: profilePubkeys.length,
            },
          ])
          .then((events) => applyPresenceEvents(events, profilePubkeys))
          .catch(() => undefined),
      ]);
      const botPubkeys = new Set(
        nextChannels.flatMap((channel) =>
          channel.members.filter((member) => member.role === "bot").map((member) => member.pubkey),
        ),
      );
      setProfiles((current) =>
        Object.fromEntries(
          Object.entries(current).map(([key, profile]) => [
            key,
            { ...profile, isAgent: profile.isAgent || botPubkeys.has(key) },
          ]),
        ),
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("error.channelLoad"));
      throw loadError;
    } finally {
      setLoadingChannels(false);
    }
  }, [applyPresenceEvents, client, config.agents, demo, loadProfiles, pubkey]);

  useEffect(() => {
    if (!demo) return;
    const codex = config.agents[0]?.pubkey ?? "1".repeat(64);
    const grok = config.agents[1]?.pubkey ?? "2".repeat(64);
    const general = "11111111-2222-4333-8444-555555555555";
    const direct = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const demoProfiles: Record<string, UserProfile> = {
      ...profileSeed(config, pubkey),
      [pubkey]: { ...fallbackProfile(pubkey, "Alex"), about: "Engineering", isAgent: false },
      [codex]: {
        ...fallbackProfile(codex, "Codex(remote)", true),
        about: "Remote coding and operations assistant",
      },
      [grok]: {
        ...fallbackProfile(grok, "Grok(remote)", true),
        about: "Research and reasoning assistant",
      },
    };
    setProfiles(demoProfiles);
    const generalChannel: BuzzChannel = {
      id: general,
      name: "general",
      description: "Team collaboration and agent tasks",
      topic: "Build, operate, and learn together",
      type: "stream",
      visibility: "open",
      archived: false,
      isMember: true,
      members: [
        { pubkey, role: "owner" },
        { pubkey: codex, role: "bot" },
        { pubkey: grok, role: "bot" },
      ],
      participantPubkeys: [pubkey, codex, grok],
    };
    const directChannel: BuzzChannel = {
      id: direct,
      name: "Codex(remote)",
      description: "",
      topic: null,
      type: "dm",
      visibility: "private",
      archived: false,
      isMember: true,
      members: [
        { pubkey, role: "owner" },
        { pubkey: codex, role: "bot" },
      ],
      participantPubkeys: [pubkey, codex],
    };
    const discoverableChannel: BuzzChannel = {
      id: "77777777-2222-4333-8444-555555555555",
      name: "product",
      description: "An open channel available to join",
      topic: null,
      type: "stream",
      visibility: "open",
      archived: false,
      isMember: false,
      members: [{ pubkey: grok, role: "owner" }],
      participantPubkeys: [grok],
    };
    setChannels([generalChannel, directChannel]);
    setDiscoveredChannels([generalChannel, directChannel, discoverableChannel]);
    setSelectedChannelId(general);
    const now = Math.floor(Date.now() / 1000);
    const relayPubkey = "3".repeat(64);
    setContentEvents([
      demoSystemEvent(
        "d",
        relayPubkey,
        general,
        { type: "channel_created", actor: pubkey },
        now - 420,
      ),
      demoSystemEvent(
        "e",
        relayPubkey,
        general,
        { type: "member_joined", actor: pubkey, target: codex },
        now - 410,
      ),
      demoSystemEvent(
        "f",
        relayPubkey,
        general,
        { type: "member_joined", actor: pubkey, target: grok },
        now - 400,
      ),
      demoEvent("a", pubkey, general, "@Codex(remote) Check the Relay deployment.", now - 240, [
        ["p", codex],
      ]),
      demoEvent(
        "b",
        codex,
        general,
        "Relay is healthy. Postgres, Redis, MinIO, and Git are available.",
        now - 205,
      ),
      demoEvent("c", pubkey, general, "Document the Web client deployment as well.", now - 80),
      demoEvent("1", codex, general, "Can you review the deployment checklist?", now - 55, [
        ["p", pubkey],
      ]),
      demoEvent("2", codex, direct, "The Relay health checks are all passing.", now - 115, [
        ["p", pubkey],
      ]),
      demoEvent(
        "3",
        codex,
        general,
        "Verification is complete and the result is attached.",
        now - 40,
        [["e", "c".repeat(64), "", "reply"]],
      ),
    ]);
    setPresence({ [pubkey]: "online", [codex]: "online", [grok]: "offline" });
    setLoadingChannels(false);
  }, [config, demo, pubkey]);

  useEffect(() => {
    if (!client || demo) return;
    const unsubscribeState = client.onStateChange(setConnectionState);
    let unsubscribePresence: (() => void) | null = null;
    let cancelled = false;
    const publishPresence = (status: "online" | "away" | "offline") =>
      client.publish({
        kind: 20001,
        content: status,
        tags: [["status", status]],
      });

    void client
      .connect()
      .then(async () => {
        if (cancelled) return;
        await loadChannels();
        unsubscribePresence = await client.subscribe({ kinds: [20001], limit: 0 }, (event) => {
          applyPresenceEvents([event]);
        });
        await publishPresence("online").catch(() => undefined);
        presenceUpdatedAt.current[pubkey.toLowerCase()] = Date.now();
        setPresence((current) => ({ ...current, [pubkey]: "online" }));
      })
      .catch((connectError) => {
        if (!cancelled) {
          setError(connectError instanceof Error ? connectError.message : t("error.relayConnect"));
        }
      });

    const heartbeat = window.setInterval(() => {
      if (client.connectionState === "connected") {
        void publishPresence("online").catch(() => undefined);
        presenceUpdatedAt.current[pubkey.toLowerCase()] = Date.now();
        setPresence((current) => ({ ...current, [pubkey]: "online" }));
      }
    }, 30_000);
    const handleVisibility = () => {
      if (client.connectionState !== "connected") return;
      const status: "away" | "online" = document.hidden ? "away" : "online";
      void publishPresence(status).catch(() => undefined);
      presenceUpdatedAt.current[pubkey.toLowerCase()] = Date.now();
      setPresence((current) => ({ ...current, [pubkey]: status }));
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribePresence?.();
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", handleVisibility);
      client.disconnect();
    };
  }, [applyPresenceEvents, client, demo, loadChannels, pubkey]);

  useEffect(() => {
    if (demo) return;
    const timer = window.setInterval(() => {
      const expiry = Date.now() - 95_000;
      setPresence((current) => {
        let changed = false;
        const next = { ...current };
        for (const [subject, status] of Object.entries(current)) {
          const updatedAt = presenceUpdatedAt.current[subject] ?? 0;
          if (status !== "offline" && updatedAt > 0 && updatedAt < expiry) {
            next[subject] = "offline";
            delete presenceUpdatedAt.current[subject];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [demo]);

  useEffect(() => {
    if (!client || demo || !selectedChannelId) return;
    let cancelled = false;
    let unsubscribeChannel: (() => void) | null = null;
    let unsubscribeTyping: (() => void) | null = null;
    setLoadingMessages(true);
    setContentEvents([]);
    setAuxiliaryEvents([]);
    const startedAt = Math.floor(Date.now() / 1000) - 2;
    const anchorIds =
      messageAnchor?.channelId === selectedChannelId
        ? [messageAnchor.eventId, messageAnchor.threadRootId].filter((eventId): eventId is string =>
            Boolean(eventId),
          )
        : [];
    void Promise.all([
      client.query({ kinds: TIMELINE_KINDS, "#h": [selectedChannelId], limit: 150 }),
      client.query({ kinds: [39002], "#d": [selectedChannelId], limit: 1 }),
      anchorIds.length
        ? client.query({
            ids: [...new Set(anchorIds)],
            kinds: TIMELINE_KINDS,
            "#h": [selectedChannelId],
            limit: anchorIds.length,
          })
        : Promise.resolve([]),
    ])
      .then(async ([history, memberEvents, anchorEvents]) => {
        if (cancelled) return;
        const anchoredHistory = anchorEvents.filter(
          (event) => anchorIds.includes(event.id) && eventChannelId(event) === selectedChannelId,
        );
        const nextContentEvents = mergeEvents(history, anchoredHistory);
        setContentEvents(nextContentEvents);
        const members = memberEvents[0]
          ? memberEvents[0].tags.filter((tag) => tag[0] === "p").map((tag) => tag[1])
          : [];
        await loadProfiles([...members, ...nextContentEvents.flatMap(systemMessagePubkeys)]);
        unsubscribeChannel = await client.subscribe(
          {
            kinds: [...TIMELINE_KINDS, ...AUXILIARY_KINDS],
            "#h": [selectedChannelId],
            since: startedAt,
          },
          (event) => {
            if (TIMELINE_KINDS.includes(event.kind)) {
              setContentEvents((current) => mergeEvents(current, [event]));
              if (event.kind === 40099) void loadProfiles(systemMessagePubkeys(event));
              setDelivery((current) => {
                if (!(event.id in current)) return current;
                const next = { ...current };
                delete next[event.id];
                return next;
              });
            } else {
              setAuxiliaryEvents((current) => mergeEvents(current, [event]));
            }
          },
        );
        unsubscribeTyping = await client.subscribe(
          { kinds: [20002], "#h": [selectedChannelId], since: startedAt, limit: 0 },
          (event) => {
            if (event.pubkey.toLowerCase() === pubkey.toLowerCase()) return;
            setTypingExpiry((current) => ({
              ...current,
              [event.pubkey.toLowerCase()]: Date.now() + 8_000,
            }));
          },
        );
      })
      .catch((loadError) => {
        if (!cancelled)
          setError(loadError instanceof Error ? loadError.message : t("error.messageLoad"));
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
      unsubscribeChannel?.();
      unsubscribeTyping?.();
    };
  }, [client, demo, loadProfiles, messageAnchor, pubkey, selectedChannelId]);

  const visibleContentEvents = useMemo(
    () =>
      selectedChannelId
        ? contentEvents.filter((event) => eventChannelId(event) === selectedChannelId)
        : [],
    [contentEvents, selectedChannelId],
  );
  const messageIds = useMemo(
    () => visibleContentEvents.map((event) => event.id).slice(-150),
    [visibleContentEvents],
  );

  useEffect(() => {
    if (!client || demo || !messageIds.length) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const since = Math.floor(Date.now() / 1000) - 2;
    void client
      .query({ kinds: AUXILIARY_KINDS, "#e": messageIds, limit: 10_000 })
      .then((events) => {
        if (!cancelled) setAuxiliaryEvents((current) => mergeEvents(current, events));
      })
      .then(async () => {
        unsubscribe = await client.subscribe(
          { kinds: AUXILIARY_KINDS, "#e": messageIds, since, limit: 0 },
          (event) => setAuxiliaryEvents((current) => mergeEvents(current, [event])),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, demo, messageIds]);

  const reactionEventIdsKey = useMemo(() => {
    const visibleIds = new Set(messageIds);
    return auxiliaryEvents
      .filter(
        (event) =>
          event.kind === 7 && visibleIds.has(event.tags.find((tag) => tag[0] === "e")?.[1] ?? ""),
      )
      .map((event) => event.id)
      .sort()
      .join(",");
  }, [auxiliaryEvents, messageIds]);

  useEffect(() => {
    if (!client || demo || !reactionEventIdsKey) return;
    const reactionEventIds = reactionEventIdsKey.split(",");
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const since = Math.floor(Date.now() / 1000) - 2;
    void client
      .query({ kinds: [5, 9005], "#e": reactionEventIds, limit: 10_000 })
      .then((events) => {
        if (!cancelled) setAuxiliaryEvents((current) => mergeEvents(current, events));
      })
      .then(async () => {
        unsubscribe = await client.subscribe(
          { kinds: [5, 9005], "#e": reactionEventIds, since, limit: 0 },
          (event) => setAuxiliaryEvents((current) => mergeEvents(current, [event])),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, demo, reactionEventIdsKey]);

  useEffect(() => {
    if (!Object.keys(typingExpiry).length) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingExpiry((current) =>
        Object.fromEntries(Object.entries(current).filter(([, expiry]) => expiry > now)),
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [typingExpiry]);

  const messages = useMemo(
    () => buildTimeline(visibleContentEvents, auxiliaryEvents, pubkey.toLowerCase(), delivery),
    [auxiliaryEvents, delivery, pubkey, visibleContentEvents],
  );

  const visibleChannels = useMemo(
    () => applyPendingRoles(channels, pendingRoles),
    [channels, pendingRoles],
  );
  const visibleDiscoveredChannels = useMemo(
    () => applyPendingRoles(discoveredChannels, pendingRoles),
    [discoveredChannels, pendingRoles],
  );
  const selectedChannel =
    visibleChannels.find((channel) => channel.id === selectedChannelId) ?? null;

  useEffect(() => {
    setPendingRoles((current) => {
      const settled = settlePendingRoles(current, rosterVersions);
      return settled.length === current.length ? current : settled;
    });
  }, [rosterVersions]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutations = useSessionMutations({
    client,
    demo,
    pubkey,
    channels,
    discoveredChannels,
    communityRole,
    selectedChannel,
    messages,
    profiles,
    setChannels,
    setDiscoveredChannels,
    setSelectedChannelId,
    setContentEvents,
    setAuxiliaryEvents,
    setDelivery,
    setProfiles,
    loadChannels,
    loadProfiles,
  });

  const mutateChannelMember = mutations.setChannelMember;
  const setChannelMember = useCallback(
    async (channelId: string, memberPubkey: string, role: "admin" | "member" | "guest") => {
      const baseline = rosterCache.current.get(channelId)?.created_at ?? 0;
      // Resolves after the Relay's OK and one roster reload.
      await mutateChannelMember(channelId, memberPubkey, role);
      if (demo || (rosterCache.current.get(channelId)?.created_at ?? 0) > baseline) return;
      // The relay-signed roster lags the accepted command: keep the accepted
      // role visible until a newer roster is observed instead of letting the
      // stale roster revert it, and re-read the roster until it catches up.
      const pubkeyLower = memberPubkey.toLowerCase();
      setPendingRoles((current) => [
        ...current.filter(
          (change) => change.channelId !== channelId || change.pubkey !== pubkeyLower,
        ),
        { channelId, pubkey: pubkeyLower, role, rosterVersion: baseline },
      ]);
      void (async () => {
        for (const delay of [500, 1_000, 2_000, 4_000, 8_000]) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (!mountedRef.current) return;
          if ((rosterCache.current.get(channelId)?.created_at ?? 0) > baseline) return;
          await loadChannels().catch(() => undefined);
        }
      })();
    },
    [demo, loadChannels, mutateChannelMember],
  );

  const leaveChannel = useCallback(
    async (channelId: string) => {
      if (demo) {
        setChannels((current) => current.filter((channel) => channel.id !== channelId));
        return;
      }
      if (!client) throw new Error(t("error.relayClient"));
      // NIP-29 leave request; the Relay removes the caller from the roster.
      await client.publish({ kind: 9022, content: "", tags: [["h", channelId]] });
      await loadChannels();
    },
    [client, demo, loadChannels],
  );

  const search = useCallback(
    async (term: string, channelId?: string): Promise<SearchHit[]> => {
      if (term.trim().length < 2) return [];
      if (demo) {
        return contentEvents
          .filter(
            (event) =>
              (!channelId || eventChannelId(event) === channelId) &&
              event.content.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
          )
          .map((event) => ({ event, channelId: eventChannelId(event) }));
      }
      if (!client) return [];
      const events = await client.query({
        kinds: [9, 40002, 40008, 45001, 45003],
        search: term.trim(),
        limit: 50,
        ...(channelId ? { "#h": [channelId] } : {}),
      });
      await loadProfiles(events.map((event) => event.pubkey));
      return events
        .map((event) => ({ event, channelId: eventChannelId(event) }))
        .filter((hit) => Boolean(hit.channelId) && (!channelId || hit.channelId === channelId));
    },
    [client, contentEvents, demo, loadProfiles],
  );

  const notifyTyping = useCallback(
    (replyTarget: ReplyTarget = null) => {
      if (demo || !client || !selectedChannelId || Date.now() - typingSentAt.current < 3_000)
        return;
      typingSentAt.current = Date.now();
      const tags: string[][] = [["h", selectedChannelId]];
      if (replyTarget) {
        if (replyTarget.rootId !== replyTarget.id) tags.push(["e", replyTarget.rootId, "", "root"]);
        tags.push(["e", replyTarget.id, "", "reply"]);
      }
      void client.publish({ kind: 20002, content: "", tags }).catch(() => undefined);
    },
    [client, demo, selectedChannelId],
  );

  const selectChannel = useCallback((channelId: string) => {
    setMessageAnchor(null);
    setSelectedChannelId(channelId);
  }, []);

  const revealMessage = useCallback((anchor: MessageAnchor) => {
    setMessageAnchor(anchor);
    setSelectedChannelId(anchor.channelId);
  }, []);

  const state: SessionState = {
    connectionState,
    error,
    channels: visibleChannels,
    selectedChannelId,
    messages,
    profiles,
    presence,
    typingPubkeys: Object.keys(typingExpiry),
    communityRole,
    loadingChannels,
    loadingMessages,
  };

  return {
    state,
    selectedChannel,
    discoveredChannels: visibleDiscoveredChannels,
    selectChannel,
    revealMessage,
    ...mutations,
    setChannelMember,
    leaveChannel,
    search,
    notifyTyping,
    ensureProfiles: loadProfiles,
    refreshChannels: loadChannels,
  };
}

export type BuzzSession = ReturnType<typeof useBuzzSession>;
