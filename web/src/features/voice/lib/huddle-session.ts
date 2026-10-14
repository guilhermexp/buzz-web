import { HuddleConnection, HuddleHandshakeError } from "@/features/voice/lib/huddle-connection";
import { HuddleMedia } from "@/features/voice/lib/huddle-media";
import { humansInHuddle, lifecycleEphemeralChannelId } from "@/features/voice/lib/huddle-presence";
import {
  type HuddleErrorCode,
  type HuddleReaction,
  type HuddleSnapshot,
  IDLE_HUDDLE,
  KIND_HUDDLE_ENDED,
  KIND_HUDDLE_REACTION,
  KIND_HUDDLE_STARTED,
  KIND_MEMBER_REMOVED_NOTIFICATION,
} from "@/features/voice/lib/huddle-types";
import {
  listAudioDevices,
  microphoneErrorCode,
  supportsOutputSelection,
} from "@/features/voice/lib/microphone";
import type { EventTemplate, NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

const EPHEMERAL_TTL_SECONDS = 3600;
const REACTION_VISIBLE_MS = 4_000;
const REACTION_NAME_MAX = 48;
const MAX_VISIBLE_REACTIONS = 6;
const PUBLISH_ATTEMPTS = 4;

type Active = {
  generation: number;
  parentChannelId: string;
  ephemeralChannelId: string | null;
  media: HuddleMedia | null;
  connection: HuddleConnection | null;
  unsubscribers: (() => void)[];
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clampName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= REACTION_NAME_MAX
    ? trimmed
    : `${trimmed.slice(0, REACTION_NAME_MAX - 1).trimEnd()}…`;
}

/** The wait a relay "rate-limited: … retry in Ns" rejection asks for, else null. */
export function rateLimitDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : "";
  if (!/^\s*rate-limited\s*:/i.test(message)) return null;
  const retry = message.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s|m)\b/i);
  if (!retry) return 1_000;
  const value = Number.parseFloat(retry[1] ?? "1");
  const unit = retry[2]?.toLowerCase();
  const milliseconds = value * (unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1);
  return Math.min(Math.max(Math.ceil(milliseconds), 250), 10_000);
}

/**
 * One identity's Huddle session on one Relay. Implements desktop's room
 * lifecycle: start = private ephemeral stream channel (9007, ttl 3600) + 48100
 * in the parent; join = authenticated audio socket; leave = leave frame +
 * close, then end (48103 + archive) when the last human leaves, else 9022.
 * Removal from the parent channel (44101 or the relay's membership_revoked)
 * tears the session down immediately, without reconnecting.
 */
export class HuddleController {
  private snapshot: HuddleSnapshot = IDLE_HUDDLE;
  private readonly listeners = new Set<() => void>();
  private active: Active | null = null;
  private generation = 0;
  private preferredInput: string | null = null;
  private preferredOutput: string | null = null;
  private relayWasActive = false;
  private readonly stopWatchingRelay: () => void;
  private readonly reactionTimers = new Set<number>();

  constructor(
    readonly client: BuzzRelayClient,
    readonly pubkey: string,
  ) {
    this.stopWatchingRelay = client.onStateChange((state) => {
      if (state !== "idle") this.relayWasActive = true;
      else if (this.relayWasActive) this.teardown(null, false);
    });
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("online", this.handleOnline);
    navigator.mediaDevices?.addEventListener?.("devicechange", this.handleDeviceChange);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<HuddleSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private syncMedia() {
    const media = this.active?.media;
    if (!media) return;
    this.update({
      muted: media.muted,
      deafened: media.deafened,
      microphoneLost: media.microphoneLost,
      participants: media.participants,
      inputDeviceId: media.engine.inputDeviceId ?? this.preferredInput,
      error: media.microphoneLost ? (this.snapshot.error ?? "deviceLost") : this.snapshot.error,
    });
  }

  private readonly handlePageHide = () => this.teardown(null, true);
  private readonly handleOnline = () => this.active?.connection?.retryNow();
  private readonly handleDeviceChange = () => void this.refreshDevices();

  private async refreshDevices() {
    if (this.snapshot.phase === "idle") return;
    const { inputs, outputs } = await listAudioDevices().catch(() => ({ inputs: [], outputs: [] }));
    this.update({ inputs, outputs, outputSelectable: supportsOutputSelection() });
  }

  start(parentChannelId: string) {
    return this.enter(parentChannelId, null);
  }

  join(parentChannelId: string, ephemeralChannelId: string) {
    return this.enter(parentChannelId, ephemeralChannelId);
  }

  private async enter(parentChannelId: string, existingEphemeral: string | null) {
    if (this.active) return;
    const generation = ++this.generation;
    const active: Active = {
      generation,
      parentChannelId,
      ephemeralChannelId: existingEphemeral,
      media: null,
      connection: null,
      unsubscribers: [],
    };
    this.active = active;
    const creating = existingEphemeral === null;
    this.update({
      ...IDLE_HUDDLE,
      phase: creating ? "starting" : "joining",
      parentChannelId,
      ephemeralChannelId: existingEphemeral,
      isCreator: creating,
    });
    const current = () => this.active === active && this.generation === generation;
    let channelCreated = false;
    let startPublished = false;
    try {
      // Microphone first: a denied permission must not leave an empty room behind.
      active.media = await HuddleMedia.open({
        selfPubkey: this.pubkey,
        inputDeviceId: this.preferredInput,
        onChange: () => {
          if (current()) this.syncMedia();
        },
      });
      if (!current()) {
        await active.media.close();
        return;
      }
      await this.watchRevocation(active, parentChannelId);
      let ephemeralChannelId = existingEphemeral;
      if (!ephemeralChannelId) {
        ephemeralChannelId = crypto.randomUUID();
        await this.publish({
          kind: 9007,
          content: "",
          tags: [
            ["h", ephemeralChannelId],
            ["name", `huddle-${ephemeralChannelId.slice(0, 8)}`],
            ["visibility", "private"],
            ["channel_type", "stream"],
            ["ttl", String(EPHEMERAL_TTL_SECONDS)],
          ],
        });
        channelCreated = true;
        await this.publish({
          kind: KIND_HUDDLE_STARTED,
          content: JSON.stringify({ ephemeral_channel_id: ephemeralChannelId }),
          tags: [["h", parentChannelId]],
        });
        startPublished = true;
      }
      active.ephemeralChannelId = ephemeralChannelId;
      if (!current()) throw new HuddleHandshakeError("join");
      const media = active.media;
      const connection = new HuddleConnection(
        this.client.relayUrl,
        ephemeralChannelId,
        parentChannelId,
        {
          onJoined: (self, peers) => {
            if (!current()) return;
            media.joined(self, peers);
            this.update({ phase: "connected" });
          },
          onPeerJoined: (peer) => current() && media.addPeer(peer),
          onPeerLeft: (pubkey, peerIndex) => current() && media.removePeer(pubkey, peerIndex),
          onRoster: (peers) => current() && media.replaceRoster(peers),
          onFrame: (frame) => media.receive(frame),
          onReconnecting: () => {
            if (current()) this.update({ phase: "reconnecting" });
          },
          onTerminal: (code) => {
            if (current()) this.teardown(code, false);
          },
        },
      );
      active.connection = connection;
      media.setSender((frame) => connection.send(frame));
      this.update({ ephemeralChannelId });
      await connection.open();
      if (!current()) return;
      await this.watchHuddle(active, parentChannelId, ephemeralChannelId);
      this.syncMedia();
      void this.refreshDevices();
    } catch (error) {
      if (!current()) return;
      let code: HuddleErrorCode;
      if (error instanceof HuddleHandshakeError)
        code = error.code === "retry" ? "join" : error.code;
      else if (active.media) code = creating ? "start" : "join";
      else if (error instanceof DOMException) code = microphoneErrorCode(error);
      else code = "codec";
      this.teardown(code, false);
      if (startPublished && active.ephemeralChannelId) {
        void this.endRoom(parentChannelId, active.ephemeralChannelId);
      } else if (channelCreated && active.ephemeralChannelId) {
        void this.archive(active.ephemeralChannelId);
      }
    }
  }

  /** Leave on removal from the parent channel (relay-signed 44101 with p = self). */
  private async watchRevocation(active: Active, parentChannelId: string) {
    const unsubscribe = await this.client.subscribe(
      { kinds: [KIND_MEMBER_REMOVED_NOTIFICATION], "#p": [this.pubkey], since: nowSeconds() - 5 },
      (event) => {
        if (this.active !== active) return;
        if (event.tags.some((tag) => tag[0] === "h" && tag[1] === parentChannelId)) {
          this.teardown("revoked", false);
        }
      },
    );
    if (this.active === active) active.unsubscribers.push(unsubscribe);
    else unsubscribe();
  }

  /** Follow the room: an explicit end, and reactions from other participants. */
  private async watchHuddle(active: Active, parentChannelId: string, ephemeralChannelId: string) {
    const since = nowSeconds();
    const subscriptions = await Promise.allSettled([
      this.client.subscribe(
        { kinds: [KIND_HUDDLE_ENDED], "#h": [parentChannelId], since },
        (event) => {
          if (this.active !== active) return;
          if (lifecycleEphemeralChannelId(event) === ephemeralChannelId)
            this.teardown("ended", false);
        },
      ),
      this.client.subscribe(
        { kinds: [KIND_HUDDLE_REACTION], "#h": [ephemeralChannelId], since },
        (event) => {
          if (this.active === active && event.pubkey !== this.pubkey) this.showReaction(event);
        },
      ),
    ]);
    for (const result of subscriptions) {
      if (result.status !== "fulfilled") continue;
      if (this.active === active) active.unsubscribers.push(result.value);
      else result.value();
    }
  }

  private showReaction(event: NostrEvent) {
    const emoji = (event.tags.find((tag) => tag[0] === "reaction")?.[1] ?? event.content).trim();
    if (!emoji || emoji.length > 32) return;
    const reaction: HuddleReaction = {
      id: event.id,
      pubkey: event.pubkey,
      emoji,
      senderName: clampName(event.tags.find((tag) => tag[0] === "sender_name")?.[1] ?? ""),
    };
    if (this.snapshot.reactions.some((item) => item.id === reaction.id)) return;
    this.update({
      reactions: [...this.snapshot.reactions, reaction].slice(-MAX_VISIBLE_REACTIONS),
    });
    const timer = window.setTimeout(() => {
      this.reactionTimers.delete(timer);
      this.update({ reactions: this.snapshot.reactions.filter((item) => item.id !== reaction.id) });
    }, REACTION_VISIBLE_MS);
    this.reactionTimers.add(timer);
  }

  async sendReaction(emoji: string, senderName: string) {
    const ephemeralChannelId = this.active?.ephemeralChannelId;
    if (!ephemeralChannelId || this.snapshot.phase !== "connected") return;
    const event = await this.publish({
      kind: KIND_HUDDLE_REACTION,
      content: emoji,
      tags: [
        ["h", ephemeralChannelId],
        ["reaction", emoji],
        ["sender_name", clampName(senderName)],
      ],
    });
    this.showReaction(event.event);
  }

  /**
   * Stop everything this session owns: capture tracks, AudioContext, codecs,
   * socket and subscriptions. `error` is what the user is told afterwards.
   */
  private teardown(error: HuddleErrorCode | null, sendLeave: boolean) {
    const active = this.active;
    this.generation += 1;
    this.active = null;
    for (const timer of this.reactionTimers) window.clearTimeout(timer);
    this.reactionTimers.clear();
    if (active) {
      for (const unsubscribe of active.unsubscribers.splice(0)) unsubscribe();
      if (sendLeave) active.connection?.leave();
      else active.connection?.close();
      active.media?.setSender(null);
      void active.media?.close();
    }
    this.update({ ...IDLE_HUDDLE, error });
  }

  /** Leave the huddle; ends it for everyone when we were the last human. */
  async leave() {
    const active = this.active;
    if (!active) return;
    const { parentChannelId, ephemeralChannelId } = active;
    const joined = Boolean(active.connection);
    const livePubkeys = active.media?.participants.map((participant) => participant.pubkey) ?? [];
    this.teardown(null, true);
    if (!ephemeralChannelId || !joined) return;
    let humans = 2;
    try {
      const [members] = await this.client.query({
        kinds: [39002],
        "#d": [ephemeralChannelId],
        limit: 1,
      });
      humans = humansInHuddle(members ?? null, livePubkeys);
    } catch {
      // Unknown membership: keep the room (desktop's safe default).
    }
    if (humans <= 1) await this.endRoom(parentChannelId, ephemeralChannelId);
    else {
      await this.publish({ kind: 9022, content: "", tags: [["h", ephemeralChannelId]] }).catch(
        () => undefined,
      );
    }
  }

  private async endRoom(parentChannelId: string, ephemeralChannelId: string) {
    await this.publish({
      kind: KIND_HUDDLE_ENDED,
      content: JSON.stringify({ ephemeral_channel_id: ephemeralChannelId }),
      tags: [["h", parentChannelId]],
    }).catch(() => undefined);
    await this.archive(ephemeralChannelId);
  }

  /** Publish, waiting out the relay's per-identity rate limit a few times. */
  private async publish(template: EventTemplate) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.client.publish(template);
      } catch (error) {
        const delay = rateLimitDelayMs(error);
        if (delay === null || attempt >= PUBLISH_ATTEMPTS) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
  }

  private async archive(ephemeralChannelId: string) {
    await this.publish({
      kind: 9002,
      content: "",
      tags: [
        ["h", ephemeralChannelId],
        ["archived", "true"],
      ],
    }).catch(() => undefined);
  }

  toggleMute() {
    const media = this.active?.media;
    if (media && !media.microphoneLost) media.setMuted(!media.muted);
  }

  toggleDeafen() {
    const media = this.active?.media;
    if (media) media.setDeafened(!media.deafened);
  }

  async selectInput(deviceId: string | null) {
    const media = this.active?.media;
    this.preferredInput = deviceId;
    if (!media) return;
    try {
      await media.replaceInput(deviceId);
      this.update({ error: null });
    } catch (error) {
      this.update({ error: microphoneErrorCode(error) });
    }
    void this.refreshDevices();
  }

  retryMicrophone() {
    return this.selectInput(this.preferredInput);
  }

  async selectOutput(deviceId: string | null) {
    const media = this.active?.media;
    if (!media) return;
    try {
      await media.engine.setOutput(deviceId);
      this.preferredOutput = deviceId;
      this.update({ outputDeviceId: deviceId });
    } catch {
      this.update({ outputDeviceId: this.preferredOutput });
    }
  }

  dismissError() {
    if (this.snapshot.error === "deviceLost" && this.snapshot.microphoneLost) return;
    this.update({ error: null });
  }

  /** Release the current session's capture, audio and socket without room bookkeeping. */
  hangUp() {
    if (this.active) this.teardown(null, true);
  }

  dispose() {
    this.teardown(null, true);
    this.stopWatchingRelay();
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("online", this.handleOnline);
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.handleDeviceChange);
    this.listeners.clear();
  }
}

let current: HuddleController | null = null;

/** The workspace's Huddle controller; switching identity or Relay disposes the old one. */
export function huddleControllerFor(client: BuzzRelayClient, pubkey: string): HuddleController {
  if (current && current.client === client && current.pubkey === pubkey) return current;
  current?.dispose();
  current = new HuddleController(client, pubkey);
  return current;
}
