import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import buzzAppIcon from "@/assets/app-icon@3x.png";
import { channelDisplayName } from "@/features/chat/lib/chat-model";
import type { BuzzChannel, TimelineMessage } from "@/features/chat/lib/chat-types";
import { conversationDraftKey } from "@/features/chat/lib/conversation-drafts";
import { useBuzzSession } from "@/features/chat/lib/use-buzz-session";
import { useLiveAgentActivity } from "@/features/chat/lib/use-live-agent-activity";
import { useRelayUserState } from "@/features/chat/lib/use-relay-user-state";
import {
  type WorkspaceContextValue,
  WorkspaceProvider,
} from "@/features/chat/lib/workspace-context";
import { AgentActivityPanel } from "@/features/chat/ui/AgentActivityPanel";
import { AppNavigation, type ChannelRowActions } from "@/features/chat/ui/AppNavigation";
import { ChannelDetailsPanel } from "@/features/chat/ui/ChannelDetailsPanel";
import { IdentityGate } from "@/features/chat/ui/IdentityGate";
import { useLeftPanelWidth } from "@/features/chat/ui/LeftPanelSizing";
import { ThreadPanel } from "@/features/chat/ui/ThreadPanel";
import { WorkspaceBackgroundExtras } from "@/features/chat/ui/WorkspaceExtensions";
import { requestForumFocus } from "@/features/forums/lib/forum-focus";
import type { InboxItem } from "@/features/inbox/lib/inbox-model";
import { useInbox } from "@/features/inbox/use-inbox";
import { buildBuzzDeepLink } from "@/features/push/lib/deep-link";
import { retirePushEnrollment } from "@/features/push/lib/push-enrollment";
import { useDueReminderCount } from "@/features/reminders/lib/use-reminders";
import { useDisplayPreferences } from "@/features/workspace/lib/display-preferences";
import type { SavedCommunity } from "@/features/workspace/lib/saved-communities";
import { useCommunities } from "@/features/workspace/lib/use-communities";
import { useWorkspaceClient } from "@/features/workspace/lib/use-workspace-client";
import { useWorkspacePanels } from "@/features/workspace/lib/use-workspace-panels";
import { useWorkspaceShortcutHandler } from "@/features/workspace/lib/use-workspace-shortcut-handler";
import { ChannelSurface } from "@/features/workspace/ui/ChannelSurface";
import type { CommunityControls } from "@/features/workspace/ui/CommunityRail";
import { ToolHost } from "@/features/workspace/ui/ToolHost";
import { type WorkspaceDialog, WorkspaceDialogs } from "@/features/workspace/ui/WorkspaceDialogs";
import { clearMediaObjectUrls } from "@/shared/api/media-client";
import { loadRuntimeConfig, type RuntimeConfig } from "@/shared/config/runtime-config";
import { resolveRelayFeatures } from "@/shared/features/relay-features";
import { t } from "@/shared/i18n";
import { useRightPanelWidth } from "@/shared/ui/right-panel-sizing";

type CommunityActions = {
  controls: Omit<CommunityControls, "onAdd" | "onRemove">;
  add: (input: { name: string; relayUrl: string }) => void;
  remove: (id: string) => void;
};

function latestTimestamp(messages: TimelineMessage[], rootId: string | null): number {
  return messages
    .filter((message) => message.rootId === rootId)
    .reduce((timestamp, message) => Math.max(timestamp, message.event.created_at), 0);
}

function Workspace({
  config,
  pubkey,
  demo,
  signOut,
  communities,
}: {
  config: RuntimeConfig;
  pubkey: string;
  demo: boolean;
  signOut: () => void;
  communities: CommunityActions;
}) {
  const flushBeforeDispose = useRef<() => Promise<void>>(async () => undefined);
  const client = useWorkspaceClient(config.relayUrl, demo, flushBeforeDispose);
  const session = useBuzzSession({ client, config, pubkey, demo });
  const { state, selectedChannel } = session;
  const userState = useRelayUserState({ client, demo, relayUrl: config.relayUrl, pubkey });
  flushBeforeDispose.current = userState.flush;
  const { panels, ...panelActions } = useWorkspacePanels();
  const { activeTool, threadRootId, threadReplyTargetId, focusedMessageId } = panels;
  const { preferences, update: updatePreferences } = useDisplayPreferences();
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null);
  const [insertMention, setInsertMention] = useState<string | null>(null);
  const [relayHasProjects, setRelayHasProjects] = useState(false);
  const [unreadBoundaries, setUnreadBoundaries] = useState<Record<string, number>>({});
  const navigation = useLeftPanelWidth();
  const activityWidth = useRightPanelWidth("activity");
  const detailsWidth = useRightPanelWidth("channel");
  const threadWidth = useRightPanelWidth("thread");
  const inbox = useInbox({
    client,
    demo,
    relayUrl: config.relayUrl,
    currentPubkey: pubkey,
    configuredAgents: config.agents,
    channels: state.channels,
    ensureProfiles: session.ensureProfiles,
    readContexts: userState.contexts,
    markContextRead: userState.markContextRead,
  });
  const dueReminderCount = useDueReminderCount(config.relayUrl, pubkey);
  const threadRoot = state.messages.find((message) => message.event.id === threadRootId) ?? null;
  const threadReplyTarget =
    state.messages.find((message) => message.event.id === threadReplyTargetId) ?? null;
  const canCreateChannel = state.communityRole === "owner" || state.communityRole === "admin";
  const canManage = useCallback(
    (channel: BuzzChannel) => {
      if (canCreateChannel) return true;
      const role = channel.members.find(
        (member) => member.pubkey.toLowerCase() === pubkey.toLowerCase(),
      )?.role;
      return role === "owner" || role === "admin";
    },
    [canCreateChannel, pubkey],
  );
  const canManageChannel = selectedChannel ? canManage(selectedChannel) : false;
  const connected = state.connectionState === "connected";
  const features = resolveRelayFeatures(config.features, {
    projects: relayHasProjects,
    forum: state.channels.some((channel) => channel.type === "forum"),
  });
  const isAgentMember = useCallback(
    (member: BuzzChannel["members"][number]) =>
      member.role === "bot" || state.profiles[member.pubkey.toLowerCase()]?.isAgent === true,
    [state.profiles],
  );
  const channelAgentPubkeys = useMemo(
    () =>
      selectedChannel?.members.filter(isAgentMember).map((member) => member.pubkey.toLowerCase()) ??
      [],
    [isAgentMember, selectedChannel?.members],
  );
  const knownAgentPubkeys = useMemo(
    () => [
      ...new Set(
        state.channels.flatMap((channel) =>
          channel.members.filter(isAgentMember).map((member) => member.pubkey.toLowerCase()),
        ),
      ),
    ],
    [isAgentMember, state.channels],
  );
  const liveAgentActivity = useLiveAgentActivity({
    client,
    demo,
    knownAgentPubkeys,
    ownerPubkey: pubkey,
    channels: state.channels,
  });
  const activityStatuses = selectedChannel
    ? liveAgentActivity.statusesFor(selectedChannel.id, channelAgentPubkeys)
    : [];
  const activityItems = selectedChannel
    ? liveAgentActivity.itemsFor(selectedChannel.id, channelAgentPubkeys)
    : [];

  useEffect(() => {
    if (!client || demo || config.features.projects || !connected) return;
    let cancelled = false;
    void client
      .query({ kinds: [30617], limit: 1 })
      .then((events) => {
        if (!cancelled) setRelayHasProjects(events.length > 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, config.features.projects, connected, demo]);

  useEffect(() => {
    if (userState.syncError) toast.error(userState.syncError);
  }, [userState.syncError]);

  useEffect(() => {
    const channelId = state.selectedChannelId;
    if (!channelId || activeTool || !userState.hydrated) return;
    setUnreadBoundaries((current) =>
      current[channelId] === undefined
        ? { ...current, [channelId]: userState.contexts[channelId] ?? 0 }
        : current,
    );
    const latest = latestTimestamp(state.messages, null);
    if (latest > 0) inbox.markChannelRead(channelId, latest);
  }, [
    activeTool,
    inbox.markChannelRead,
    state.messages,
    state.selectedChannelId,
    userState.contexts,
    userState.hydrated,
  ]);

  useEffect(() => {
    if (!threadRootId || activeTool || !userState.hydrated) return;
    const latest = latestTimestamp(state.messages, threadRootId);
    if (latest > 0) inbox.markThreadRead(threadRootId, latest);
  }, [activeTool, inbox.markThreadRead, state.messages, threadRootId, userState.hydrated]);

  const handleSignOut = async () => {
    // Retire this browser's push lease while the signer can still sign it.
    await retirePushEnrollment({ client, relayUrl: config.relayUrl, pubkey }).catch(
      () => undefined,
    );
    client?.disconnect();
    clearMediaObjectUrls();
    signOut();
  };
  const selectChannel = (channelId: string) => {
    setUnreadBoundaries((current) => ({
      ...current,
      [channelId]: userState.contexts[channelId] ?? 0,
    }));
    panelActions.resetForChannel();
    setDialog(null);
    session.selectChannel(channelId);
  };
  const revealMessage = (channelId: string, eventId: string, threadId: string | null) => {
    setDialog(null);
    if (state.channels.find((channel) => channel.id === channelId)?.type === "forum") {
      // Forum topics open inside the forum view, never the timeline thread panel.
      selectChannel(channelId);
      requestForumFocus(channelId, eventId);
      return;
    }
    panelActions.reveal(eventId, threadId);
    session.revealMessage({ channelId, eventId, threadRootId: threadId });
  };
  const openInboxConversation = (item: InboxItem) => {
    if (item.channelId) revealMessage(item.channelId, item.event.id, item.threadRootId);
  };
  const openDm = async (targetPubkey: string) => {
    try {
      await session.openDm(targetPubkey);
      panelActions.resetForChannel();
      setDialog(null);
    } catch (openError) {
      toast.error(openError instanceof Error ? openError.message : t("error.dmOpen"));
    }
  };
  const openSearch = (channelId: string | null) => setDialog({ kind: "search", channelId });
  const copyText = (text: string, success: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(success))
      .catch(() => toast.error(t("workspace.copyFailed")));

  useWorkspaceShortcutHandler(dialog !== null || panels.mobileNavigationOpen, (shortcut) => {
    if (shortcut === "search") openSearch(null);
    else if (shortcut === "search-channel") {
      if (!selectedChannel || activeTool) return false;
      openSearch(selectedChannel.id);
    } else if (shortcut === "settings") panelActions.openTool("settings");
    else if (shortcut === "browse-channels") setDialog({ kind: "browse", initialView: "browse" });
    else if (shortcut === "create-channel") {
      if (!canCreateChannel) return false;
      setDialog({ kind: "browse", initialView: "create" });
    } else if (shortcut === "new-dm") panelActions.openTool("new-dm");
    else if (shortcut === "mark-all-read") inbox.markAllRead();
    else if (shortcut === "mark-current-read") {
      if (!selectedChannel || activeTool) return false;
      const latestChannelMessage = latestTimestamp(state.messages, null);
      if (latestChannelMessage > 0) inbox.markChannelRead(selectedChannel.id, latestChannelMessage);
      if (threadRootId) {
        const latestThreadMessage = latestTimestamp(state.messages, threadRootId);
        if (latestThreadMessage > 0) inbox.markThreadRead(threadRootId, latestThreadMessage);
      }
    }
    return true;
  });

  const displayName = selectedChannel
    ? channelDisplayName(selectedChannel, state.profiles, pubkey)
    : "Buzz";
  const channelLabel =
    selectedChannel?.type === "dm" ? displayName : `#${selectedChannel ? displayName : ""}`;
  const typingNames = state.typingPubkeys
    .filter(
      (typingPubkey) =>
        !liveAgentActivity.healthy || !channelAgentPubkeys.includes(typingPubkey.toLowerCase()),
    )
    .map((typingPubkey) => state.profiles[typingPubkey]?.name)
    .filter((name): name is string => Boolean(name));
  const threadFocused = Boolean(threadRoot) && preferences.threadLayout === "focus";

  const channelActions: ChannelRowActions = {
    canManage,
    canMarkUnread: inbox.canMarkChannelUnread,
    markRead: (channelId) => inbox.markChannelRead(channelId, Math.floor(Date.now() / 1_000)),
    markUnread: inbox.markChannelUnread,
    toggleStar: (channelId) =>
      userState.setChannelStarred(channelId, !userState.starredChannelIds.has(channelId)),
    toggleMute: (channelId) =>
      userState.setChannelMuted(channelId, !userState.mutedChannelIds.has(channelId)),
    copyLink: (channelId) =>
      copyText(
        buildBuzzDeepLink({ relayUrl: config.relayUrl, channelId }),
        t("workspace.sidebar.linkCopied"),
      ),
    copyId: (channelId) => copyText(channelId, t("workspace.sidebar.idCopied")),
    openDetails: (channelId) => {
      if (state.selectedChannelId !== channelId) selectChannel(channelId);
      panelActions.toggleChannelDetails();
    },
    leave: (channel) => setDialog({ kind: "leave", channel }),
    archive: (channel) => setDialog({ kind: "archive", channel }),
  };

  const workspaceContext: WorkspaceContextValue = {
    client,
    demo,
    config,
    relayUrl: config.relayUrl,
    pubkey,
    connected,
    channels: state.channels,
    profiles: state.profiles,
    presence: state.presence,
    selectedChannel,
    canManageSelectedChannel: canManageChannel,
    ensureProfiles: session.ensureProfiles,
    refreshChannels: session.refreshChannels,
    selectChannel,
    revealMessage,
    showSidePanel: panelActions.showSidePanel,
    readContexts: userState.contexts,
    markContextRead: userState.markContextRead,
    mutedChannelIds: userState.mutedChannelIds,
  };

  return (
    <WorkspaceProvider value={workspaceContext}>
      <WorkspaceBackgroundExtras />
      <div className="buzz-app-surface flex h-dvh min-h-0 w-full overflow-hidden pb-14 md:pb-0">
        <AppNavigation
          activeTool={activeTool}
          canCreateChannel={canCreateChannel}
          canManageMembers={canCreateChannel}
          channelActions={channelActions}
          channels={state.channels}
          channelUnreadCounts={inbox.channelUnreadCounts}
          communities={{
            ...communities.controls,
            onAdd: () => setDialog({ kind: "add-community" }),
            onRemove: (community) => setDialog({ kind: "remove-community", community }),
          }}
          communityName={config.communityName}
          connectionState={state.connectionState}
          currentPubkey={pubkey}
          features={features}
          inboxUnreadCount={inbox.unreadCount + dueReminderCount}
          maximumWidth={navigation.maximum}
          mobileOpen={panels.mobileNavigationOpen}
          mutedChannelIds={userState.mutedChannelIds}
          panelWidth={navigation.panelWidth}
          presence={state.presence}
          profiles={state.profiles}
          relayUrl={config.relayUrl}
          selectedChannelId={state.selectedChannelId}
          starredChannelIds={userState.starredChannelIds}
          tools={{
            workflows: !demo,
            pulse: !demo,
            remote: !demo && Boolean(config.agentControlUrl),
          }}
          onBrowseChannels={() => setDialog({ kind: "browse", initialView: "browse" })}
          onCloseMobile={() => panelActions.setMobileNavigationOpen(false)}
          onInvite={() => setDialog({ kind: "invite" })}
          onNewDm={() => panelActions.toggleTool("new-dm")}
          onResize={navigation.setPanelWidth}
          onSearch={() => openSearch(null)}
          onSelectChannel={selectChannel}
          onSettings={() => panelActions.toggleTool("settings")}
          onShowMessages={panelActions.showMessages}
          onSwitchIdentity={() => void handleSignOut()}
          onToggleTool={panelActions.toggleTool}
        />

        <section className="buzz-content-surface relative flex min-h-0 min-w-0 flex-1 overflow-hidden md:mb-2 md:mr-2 md:mt-2 md:rounded-2xl md:border">
          {activeTool ? (
            <ToolHost
              canInvite={canCreateChannel}
              inbox={inbox}
              pubkey={pubkey}
              session={session}
              tool={activeTool}
              onClose={panelActions.closeTool}
              onOpenChannel={selectChannel}
              onOpenDm={openDm}
              onOpenInboxItem={openInboxConversation}
              onOpenInvites={() => setDialog({ kind: "invite" })}
              onSwitchIdentity={() => void handleSignOut()}
            />
          ) : (
            <ChannelSurface
              activity={{ itemCount: activityItems.length, statuses: activityStatuses }}
              canManageChannel={canManageChannel}
              channel={selectedChannel}
              connected={connected}
              detailsVisible={panels.channelDetailsOpen}
              displayName={displayName}
              focusedMessageId={threadRoot ? null : focusedMessageId}
              hidden={threadFocused}
              insertMention={insertMention}
              pubkey={pubkey}
              relayUrl={config.relayUrl}
              state={state}
              typingNames={typingNames}
              unreadAfter={selectedChannel ? (unreadBoundaries[selectedChannel.id] ?? null) : null}
              onAddAgent={() =>
                selectedChannel && setDialog({ kind: "add-agent", channelId: selectedChannel.id })
              }
              onAddPeople={() =>
                selectedChannel &&
                setDialog({ kind: "members", channelId: selectedChannel.id, addOpen: true })
              }
              onChangeIdentity={() => void handleSignOut()}
              onDelete={(message) => setDialog({ kind: "delete", message })}
              onEdit={(message) => setDialog({ kind: "edit", message })}
              onMentionInserted={() => setInsertMention(null)}
              onOpenActivity={panelActions.openActivityPanel}
              onOpenNavigation={() => panelActions.setMobileNavigationOpen(true)}
              onOpenThread={(message, reply) =>
                panelActions.openThread(message.event.id, reply ? message.event.id : null)
              }
              onReact={session.addReaction}
              onSearchChannel={() => selectedChannel && openSearch(selectedChannel.id)}
              onSend={async (content, attachments, extras) => {
                if (!selectedChannel) return;
                await session.sendMessage(content, attachments, null, extras);
                liveAgentActivity.markSubmitted(selectedChannel.id, channelAgentPubkeys);
              }}
              onShowMembers={() =>
                selectedChannel &&
                setDialog({ kind: "members", channelId: selectedChannel.id, addOpen: false })
              }
              onToggleDetails={panelActions.toggleChannelDetails}
              onTyping={() => session.notifyTyping()}
            />
          )}

          {activeTool ? null : panels.sidePanel ? (
            panels.sidePanel
          ) : selectedChannel && panels.activityPanelOpen ? (
            <AgentActivityPanel
              items={activityItems}
              maximumWidth={activityWidth.maximum}
              minimumWidth={activityWidth.minimum}
              panelWidth={activityWidth.panelWidth}
              profiles={state.profiles}
              statuses={activityStatuses}
              onClose={panelActions.closeActivityPanel}
              onResize={activityWidth.setPanelWidth}
            />
          ) : threadRoot ? (
            <ThreadPanel
              key={`${threadRoot.event.id}:${threadReplyTargetId ?? "thread"}`}
              canModerate={canManageChannel}
              channelLabel={channelLabel}
              currentPubkey={pubkey}
              disabled={!connected}
              draftKey={conversationDraftKey(
                config.relayUrl,
                pubkey,
                selectedChannel?.id ?? "",
                threadRoot.event.id,
              )}
              focusedMessageId={focusedMessageId}
              initialReplyTarget={threadReplyTarget}
              layout={preferences.threadLayout}
              maximumWidth={threadWidth.maximum}
              members={selectedChannel?.members ?? []}
              messages={state.messages}
              minimumWidth={threadWidth.minimum}
              panelWidth={threadWidth.panelWidth}
              presence={state.presence}
              profiles={state.profiles}
              relayUrl={config.relayUrl}
              root={threadRoot}
              onClose={panelActions.closeThread}
              onDelete={(message) => setDialog({ kind: "delete", message })}
              onEdit={(message) => setDialog({ kind: "edit", message })}
              onReact={session.addReaction}
              onResize={threadWidth.setPanelWidth}
              onSend={(content, attachments, replyTarget, extras) =>
                session.sendMessage(
                  content,
                  attachments,
                  {
                    id: replyTarget.event.id,
                    rootId: threadRoot.event.id,
                    authorPubkey: replyTarget.event.pubkey,
                  },
                  extras,
                )
              }
              onToggleLayout={() =>
                updatePreferences({
                  threadLayout: preferences.threadLayout === "focus" ? "split" : "focus",
                })
              }
              onTyping={(replyTarget) =>
                session.notifyTyping({
                  id: replyTarget.event.id,
                  rootId: threadRoot.event.id,
                  authorPubkey: replyTarget.event.pubkey,
                })
              }
            />
          ) : selectedChannel && panels.channelDetailsOpen ? (
            <ChannelDetailsPanel
              canArchive={canManageChannel && selectedChannel.type !== "dm"}
              channel={selectedChannel}
              loading={state.loadingChannels}
              maximumWidth={detailsWidth.maximum}
              minimumWidth={detailsWidth.minimum}
              muted={userState.mutedChannelIds.has(selectedChannel.id)}
              panelWidth={detailsWidth.panelWidth}
              starred={userState.starredChannelIds.has(selectedChannel.id)}
              onArchive={() => setDialog({ kind: "archive", channel: selectedChannel })}
              onClose={panelActions.closeChannelDetails}
              onRefresh={() => void session.refreshChannels()}
              onResize={detailsWidth.setPanelWidth}
              onToggleMuted={() => channelActions.toggleMute(selectedChannel.id)}
              onToggleStarred={() => channelActions.toggleStar(selectedChannel.id)}
            />
          ) : null}
        </section>

        <WorkspaceDialogs
          allowForum={features.forum}
          canCreateChannel={canCreateChannel}
          canManageChannel={canManage}
          dialog={dialog}
          pubkey={pubkey}
          session={session}
          onAddCommunity={communities.add}
          onClose={() => setDialog(null)}
          onMention={(name) => {
            setInsertMention(name);
            setDialog(null);
          }}
          onNewDm={() => panelActions.toggleTool("new-dm")}
          onOpenDialog={setDialog}
          onRemoveCommunity={(community: SavedCommunity) => communities.remove(community.id)}
          onRevealMessage={revealMessage}
          onSelectChannel={selectChannel}
        />
      </div>
    </WorkspaceProvider>
  );
}

export function BuzzWebApp() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Applies font size/density to <html> before the identity gate renders.
  useDisplayPreferences();
  useEffect(() => {
    void loadRuntimeConfig()
      .then(setConfig)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t("error.configLoad")),
      );
  }, []);

  if (!config) {
    return (
      <div className="buzz-app-surface flex min-h-dvh items-center justify-center">
        <div className="text-center">
          <img alt="Buzz" className="mx-auto h-12 w-12 rounded-xl" src={buzzAppIcon} />
          {error ? (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          ) : (
            <LoaderCircle className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
    );
  }
  return <CommunityApp config={config} />;
}

/** Selects the active community and keys the workspace by Relay + identity. */
function CommunityApp({ config }: { config: RuntimeConfig }) {
  const { communities, active, activeConfig, removableIds, select, add, remove } =
    useCommunities(config);
  const communityActions: CommunityActions = {
    controls: { communities, activeId: active.id, removableIds, onSelect: select },
    add,
    remove,
  };
  return (
    <IdentityGate
      key={activeConfig.relayUrl}
      communities={communityActions.controls}
      config={activeConfig}
    >
      {({ pubkey, signOut, demo }) => (
        <Workspace
          key={`${activeConfig.relayUrl}:${pubkey}`}
          communities={communityActions}
          config={activeConfig}
          demo={demo}
          pubkey={pubkey}
          signOut={signOut}
        />
      )}
    </IdentityGate>
  );
}
