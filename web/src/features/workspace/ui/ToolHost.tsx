import { AgentsView } from "@/features/agents/ui/AgentsView";
import type { BuzzSession } from "@/features/chat/lib/use-buzz-session";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { FeatureToolView } from "@/features/chat/ui/FeatureToolView";
import { NewDmView } from "@/features/chat/ui/NewDmView";
import { SettingsView } from "@/features/chat/ui/SettingsDialog";
import { ToolSurfaceExtras } from "@/features/chat/ui/WorkspaceExtensions";
import { type WorkspaceTool, WorkspaceToolPanel } from "@/features/chat/ui/WorkspaceToolPanel";
import type { InboxItem } from "@/features/inbox/lib/inbox-model";
import { InboxView } from "@/features/inbox/ui/InboxView";
import type { InboxState } from "@/features/inbox/use-inbox";
import { ReposPanel } from "@/features/repos/ui/ReposPanel";

/** The full-surface workspace tool (Inbox, Agents, Settings, feature tools…). */
export function ToolHost({
  tool,
  session,
  inbox,
  pubkey,
  canInvite,
  onClose,
  onOpenDm,
  onOpenInboxItem,
  onOpenChannel,
  onOpenInvites,
  onSwitchIdentity,
}: {
  tool: WorkspaceTool;
  session: BuzzSession;
  inbox: InboxState;
  pubkey: string;
  canInvite: boolean;
  onClose: () => void;
  onOpenDm: (pubkey: string) => Promise<void>;
  onOpenInboxItem: (item: InboxItem) => void;
  onOpenChannel: (channelId: string) => void;
  onOpenInvites: () => void;
  onSwitchIdentity: () => void;
}) {
  const { demo, relayUrl } = useWorkspace();
  const { state } = session;
  return (
    <WorkspaceToolPanel tool={tool}>
      <ToolSurfaceExtras />
      {tool === "agents" ? (
        <AgentsView onClose={onClose} onOpenDm={onOpenDm} />
      ) : tool === "inbox" ? (
        <InboxView
          approvalDecisions={inbox.approvalDecisions}
          approvalPending={inbox.approvalPending}
          channels={state.channels}
          demo={demo}
          error={inbox.error}
          items={inbox.items}
          loading={inbox.loading}
          profiles={state.profiles}
          relayUrl={relayUrl}
          onClose={onClose}
          onMarkAllRead={inbox.markAllRead}
          onMarkRead={inbox.markRead}
          onMarkUnread={inbox.markUnread}
          onOpenConversation={onOpenInboxItem}
          onRefresh={() => void inbox.refresh()}
          onRespondToApproval={(item, approved) => inbox.respondToApproval(item.event, approved)}
        />
      ) : tool === "new-dm" ? (
        <NewDmView
          currentPubkey={pubkey}
          profiles={state.profiles}
          relayUrl={relayUrl}
          onClose={onClose}
          onOpen={onOpenDm}
        />
      ) : tool === "repos" ? (
        <ReposPanel
          demo={demo}
          profiles={state.profiles}
          relayUrl={relayUrl}
          onClose={onClose}
          onOpenChannel={onOpenChannel}
        />
      ) : tool === "settings" ? (
        <SettingsView
          canInvite={canInvite}
          connectionState={state.connectionState}
          profile={
            state.profiles[pubkey] ?? {
              pubkey,
              name: pubkey.slice(0, 12),
              about: "",
              picture: null,
              isAgent: false,
            }
          }
          pubkey={pubkey}
          relayUrl={relayUrl}
          onClose={onClose}
          onOpenInvites={onOpenInvites}
          onSwitchIdentity={onSwitchIdentity}
          onUpdateProfile={session.updateProfile}
        />
      ) : (
        <FeatureToolView tool={tool} onClose={onClose} />
      )}
    </WorkspaceToolPanel>
  );
}
