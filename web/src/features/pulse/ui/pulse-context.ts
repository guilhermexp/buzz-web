import { createContext, useContext } from "react";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import type { ComposerMentionCandidate } from "@/features/chat/ui/MentionAutocomplete";
import type { NoteExtras } from "@/features/pulse/lib/pulse-events";
import type { Contacts } from "@/features/pulse/lib/use-pulse";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

/** Session services shared by every Pulse surface (feed, profile, thread). */
export type PulseSession = {
  client: BuzzRelayClient;
  me: string;
  relayUrl: string;
  contacts: Contacts;
  profile: (pubkey: string) => UserProfile;
  isAgent: (pubkey: string) => boolean;
  /** Desktop's Pulse mention set: me, the people I follow and agents, with known names. */
  mentionCandidates: ComposerMentionCandidate[];
  openProfile: (pubkey: string) => void;
  openThread: (noteId: string) => void;
  /** Publish a kind 1 note (reply, mentions, media); resolves with the signed event. */
  publishNote: (content: string, extras?: NoteExtras) => Promise<NostrEvent>;
  /** Fan a note this client just published out to every mounted feed. */
  onPublished: (listener: (note: NostrEvent) => void) => () => void;
};

export const PulseSessionContext = createContext<PulseSession | null>(null);

export function usePulseSession(): PulseSession {
  const session = useContext(PulseSessionContext);
  if (!session) throw new Error("usePulseSession must be used inside PulseView");
  return session;
}
