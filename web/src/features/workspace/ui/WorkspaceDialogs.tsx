import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { BuzzChannel, TimelineMessage } from "@/features/chat/lib/chat-types";
import type { BuzzSession } from "@/features/chat/lib/use-buzz-session";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import {
  ArchiveChannelDialog,
  ChannelBrowserDialog,
} from "@/features/chat/ui/ChannelBrowserDialog";
import { MemberDialog } from "@/features/chat/ui/MemberPanel";
import { DeleteMessageDialog, EditMessageDialog } from "@/features/chat/ui/MessageDialogs";
import { addCommunityMember, mintCommunityInvite } from "@/features/community/invite-api";
import { CommunityInviteDialog } from "@/features/community/ui/CommunityInviteDialog";
import { channelAddRoles } from "@/features/workspace/lib/channel-permissions";
import type { SavedCommunity } from "@/features/workspace/lib/saved-communities";
import { AddChannelAgentDialog } from "@/features/workspace/ui/AddChannelAgentDialog";
import {
  AddCommunityDialog,
  RemoveCommunityDialog,
} from "@/features/workspace/ui/CommunityDialogs";
import { SearchDialog } from "@/features/workspace/ui/SearchDialog";
import { t } from "@/shared/i18n";

export type WorkspaceDialog =
  | { kind: "browse"; initialView: "browse" | "create" }
  | { kind: "search"; channelId: string | null }
  | { kind: "invite" }
  | { kind: "members"; channelId: string; addOpen: boolean }
  | { kind: "add-agent"; channelId: string }
  | { kind: "archive"; channel: BuzzChannel }
  | { kind: "leave"; channel: BuzzChannel }
  | { kind: "edit"; message: TimelineMessage }
  | { kind: "delete"; message: TimelineMessage }
  | { kind: "add-community" }
  | { kind: "remove-community"; community: SavedCommunity };

function LeaveChannelDialog({
  channel,
  onLeave,
  onClose,
}: {
  channel: BuzzChannel;
  onLeave: () => Promise<void>;
  onClose: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogFrame title={t("workspace.sidebar.leave")} onClose={onClose}>
      <div className="space-y-4 p-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {t("workspace.sidebar.leaveConfirm", { name: channel.name })}
        </p>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5"
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-40"
            disabled={leaving}
            type="button"
            onClick={() => {
              setLeaving(true);
              setError(null);
              void onLeave()
                .then(onClose)
                .catch((leaveError) =>
                  setError(
                    leaveError instanceof Error
                      ? leaveError.message
                      : t("workspace.sidebar.leaveFailed"),
                  ),
                )
                .finally(() => setLeaving(false));
            }}
          >
            {leaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("workspace.sidebar.leaveAction")}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

/** Every modal surface of the workspace, driven by one `dialog` value. */
export function WorkspaceDialogs({
  dialog,
  session,
  pubkey,
  canCreateChannel,
  canManageChannel,
  allowForum,
  onClose,
  onOpenDialog,
  onSelectChannel,
  onRevealMessage,
  onNewDm,
  onMention,
  onAddCommunity,
  onRemoveCommunity,
}: {
  dialog: WorkspaceDialog | null;
  session: BuzzSession;
  pubkey: string;
  canCreateChannel: boolean;
  canManageChannel: (channel: BuzzChannel) => boolean;
  allowForum: boolean;
  onClose: () => void;
  onOpenDialog: (dialog: WorkspaceDialog) => void;
  onSelectChannel: (channelId: string) => void;
  onRevealMessage: (channelId: string, eventId: string, threadRootId: string | null) => void;
  onNewDm: () => void;
  onMention: (name: string) => void;
  onAddCommunity: (input: { name: string; relayUrl: string }) => void;
  onRemoveCommunity: (community: SavedCommunity) => void;
}) {
  const { client, demo, config } = useWorkspace();
  const { state } = session;
  if (!dialog) return null;
  const channelById = (id: string) => state.channels.find((channel) => channel.id === id) ?? null;

  switch (dialog.kind) {
    case "browse":
      return (
        <ChannelBrowserDialog
          key={dialog.initialView}
          allowForum={allowForum}
          canCreate={canCreateChannel}
          channels={session.discoveredChannels}
          currentPubkey={pubkey}
          initialView={dialog.initialView}
          onClose={onClose}
          onCreate={session.createChannel}
          onJoin={session.joinChannel}
          onSelect={onSelectChannel}
          onSetArchived={session.setChannelArchived}
        />
      );
    case "search":
      return (
        <SearchDialog
          channels={state.channels}
          currentPubkey={pubkey}
          profiles={state.profiles}
          scopeChannel={dialog.channelId ? channelById(dialog.channelId) : null}
          onBrowseChannels={() => onOpenDialog({ kind: "browse", initialView: "browse" })}
          onClose={onClose}
          onCreateChannel={
            canCreateChannel
              ? () => onOpenDialog({ kind: "browse", initialView: "create" })
              : undefined
          }
          onNewDm={onNewDm}
          onSearch={session.search}
          onSelect={(hit, threadRootId) =>
            onRevealMessage(hit.channelId, hit.event.id, threadRootId)
          }
          onSelectChannel={onSelectChannel}
        />
      );
    case "invite":
      return (
        <CommunityInviteDialog
          onClose={onClose}
          onAddMember={async (targetPubkey, role) => {
            if (demo) return;
            if (!client) throw new Error(t("error.relayClient"));
            await addCommunityMember(client, targetPubkey, role);
            await session.ensureProfiles([targetPubkey]);
          }}
          onMintInvite={async (options) => {
            if (demo) {
              return {
                code: "demo-code",
                expiresAt: Math.floor(Date.now() / 1_000) + options.ttlSecs,
                url: new URL(
                  `${import.meta.env.BASE_URL}invite/demo-code`,
                  window.location.origin,
                ).toString(),
                maxUses: options.maxUses,
                usesRemaining: options.maxUses,
              };
            }
            return mintCommunityInvite(config.relayUrl, options);
          }}
        />
      );
    case "members": {
      const channel = channelById(dialog.channelId);
      if (!channel) return null;
      return (
        <MemberDialog
          canManage={canManageChannel(channel)}
          channel={channel}
          currentPubkey={pubkey}
          addRoles={channelAddRoles(channel, pubkey)}
          initialAddOpen={dialog.addOpen}
          presence={state.presence}
          profiles={state.profiles}
          relayUrl={config.relayUrl}
          onClose={onClose}
          onMention={onMention}
          onOpenDm={async (target) => {
            await session.openDm(target);
            onClose();
          }}
          onRemoveMember={(targetPubkey) => session.removeChannelMember(channel.id, targetPubkey)}
          onSetMember={(targetPubkey, role) =>
            session.setChannelMember(channel.id, targetPubkey, role)
          }
        />
      );
    }
    case "add-agent": {
      const channel = channelById(dialog.channelId);
      return channel ? <AddChannelAgentDialog channel={channel} onClose={onClose} /> : null;
    }
    case "archive":
      return (
        <ArchiveChannelDialog
          channel={dialog.channel}
          onArchive={() => session.setChannelArchived(dialog.channel.id, true)}
          onClose={onClose}
        />
      );
    case "leave":
      return (
        <LeaveChannelDialog
          channel={dialog.channel}
          onClose={onClose}
          onLeave={() => session.leaveChannel(dialog.channel.id)}
        />
      );
    case "edit":
      return (
        <EditMessageDialog
          message={dialog.message}
          onClose={onClose}
          onSave={(content) => session.editMessage(dialog.message, content)}
        />
      );
    case "delete":
      return (
        <DeleteMessageDialog
          onClose={onClose}
          onConfirm={() => session.deleteMessage(dialog.message)}
        />
      );
    case "add-community":
      return <AddCommunityDialog onAdd={onAddCommunity} onClose={onClose} />;
    case "remove-community":
      return (
        <RemoveCommunityDialog
          community={dialog.community}
          onClose={onClose}
          onConfirm={() => onRemoveCommunity(dialog.community)}
        />
      );
  }
}
