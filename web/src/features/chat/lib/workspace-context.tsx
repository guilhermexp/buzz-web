import { createContext, type ReactNode, useContext } from "react";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import type { RuntimeConfig } from "@/shared/config/runtime-config";

/**
 * Session-scoped services shared with feature surfaces (tools, channel
 * extensions, side panels). One value exists per Relay + identity workspace;
 * it is recreated when either changes, so feature state keyed off it never
 * crosses communities or identities.
 */
export type WorkspaceContextValue = {
  client: BuzzRelayClient | null;
  demo: boolean;
  config: RuntimeConfig;
  relayUrl: string;
  pubkey: string;
  connected: boolean;
  channels: BuzzChannel[];
  profiles: Record<string, UserProfile>;
  selectedChannel: BuzzChannel | null;
  /** Whether the current identity may manage the selected channel. */
  canManageSelectedChannel: boolean;
  ensureProfiles: (pubkeys: string[]) => Promise<void>;
  selectChannel: (channelId: string) => void;
  /** Navigate to an event in a channel, opening its thread when given. */
  revealMessage: (channelId: string, eventId: string, threadRootId: string | null) => void;
  /** Show feature content in the right-hand panel; `null` closes it. */
  showSidePanel: (panel: ReactNode | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a Buzz workspace");
  return value;
}
