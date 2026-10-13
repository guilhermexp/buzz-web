import {
  Archive,
  ArrowDown,
  ArrowUp,
  BellOff,
  BellRing,
  Bot,
  CircleDot,
  Compass,
  Copy,
  Ellipsis,
  GitBranch,
  Hash,
  Inbox,
  Info,
  Link,
  Lock,
  LogOut,
  MailOpen,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Plus,
  Search,
  Settings,
  Star,
  StarOff,
  UserRoundCog,
  UserRoundPlus,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { channelDisplayName } from "@/features/chat/lib/chat-model";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import { connectionStateLabel } from "@/features/chat/lib/connection-state";
import { Avatar } from "@/features/chat/ui/Avatar";
import { LeftPanelResizeHandle } from "@/features/chat/ui/LeftPanelSizing";
import type { WorkspaceTool } from "@/features/chat/ui/WorkspaceToolPanel";
import { orderSection, type SidebarSection } from "@/features/workspace/lib/sidebar-organization";
import { useSidebarOrganization } from "@/features/workspace/lib/use-sidebar-organization";
import {
  type CommunityControls,
  CommunityMenuItems,
  CommunityRail,
} from "@/features/workspace/ui/CommunityRail";
import type { ContextMenuItem } from "@/features/workspace/ui/ContextMenu";
import {
  SidebarChannelSection,
  type SidebarRow,
  sidebarRowClass,
} from "@/features/workspace/ui/SidebarChannelSection";
import type { RelayConnectionState } from "@/shared/api/nostr-types";
import type { RelayFeatureState } from "@/shared/features/relay-features";
import { getLocale, t } from "@/shared/i18n";

function ConnectionDot({ state }: { state: RelayConnectionState }) {
  const color =
    state === "connected"
      ? "bg-emerald-500"
      : state === "connecting" || state === "reconnecting"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <span
      className={`block h-2 w-2 rounded-full ${color}`}
      aria-label={connectionStateLabel(state)}
      role="img"
    />
  );
}

function ChannelUnreadDot({ channelId }: { channelId: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full bg-primary"
      data-testid={`channel-unread-${channelId}`}
    />
  );
}

/** Operations offered from a sidebar row's context menu. */
export type ChannelRowActions = {
  canManage: (channel: BuzzChannel) => boolean;
  canMarkUnread: (channelId: string) => boolean;
  markRead: (channelId: string) => void;
  markUnread: (channelId: string) => void;
  toggleStar: (channelId: string) => void;
  toggleMute: (channelId: string) => void;
  copyLink: (channelId: string) => void;
  copyId: (channelId: string) => void;
  openDetails: (channelId: string) => void;
  leave: (channel: BuzzChannel) => void;
  archive: (channel: BuzzChannel) => void;
};

/** Feature tools shown in navigation; each is present only with a real backend. */
export type NavigationTools = { workflows: boolean; pulse: boolean; remote: boolean };

type ToolEntry = { tool: WorkspaceTool; label: string; icon: typeof Inbox };

export function AppNavigation({
  communityName,
  relayUrl,
  channels,
  selectedChannelId,
  profiles,
  presence,
  currentPubkey,
  connectionState,
  mobileOpen,
  canCreateChannel,
  canManageMembers,
  activeTool,
  inboxUnreadCount,
  channelUnreadCounts,
  starredChannelIds,
  mutedChannelIds,
  features,
  tools,
  communities,
  channelActions,
  maximumWidth,
  panelWidth,
  onCloseMobile,
  onSelectChannel,
  onBrowseChannels,
  onNewDm,
  onSearch,
  onSettings,
  onInvite,
  onSwitchIdentity,
  onShowMessages,
  onToggleTool,
  onResize,
}: {
  communityName: string;
  relayUrl: string;
  channels: BuzzChannel[];
  selectedChannelId: string | null;
  profiles: Record<string, UserProfile>;
  presence: Record<string, "online" | "away" | "offline">;
  currentPubkey: string;
  connectionState: RelayConnectionState;
  mobileOpen: boolean;
  canCreateChannel: boolean;
  canManageMembers: boolean;
  activeTool: WorkspaceTool | null;
  inboxUnreadCount: number;
  channelUnreadCounts: Readonly<Record<string, number>>;
  starredChannelIds: ReadonlySet<string>;
  mutedChannelIds: ReadonlySet<string>;
  features: RelayFeatureState;
  tools: NavigationTools;
  communities: CommunityControls;
  channelActions: ChannelRowActions;
  maximumWidth: number;
  panelWidth: number;
  onCloseMobile: () => void;
  onSelectChannel: (id: string) => void;
  onBrowseChannels: () => void;
  onNewDm: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onInvite: () => void;
  onSwitchIdentity: () => void;
  onShowMessages: () => void;
  onToggleTool: (tool: WorkspaceTool) => void;
  onResize: (width: number) => void;
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { organization, toggleCollapsed, move } = useSidebarOrganization(relayUrl, currentPubkey);
  const profile = profiles[currentPubkey] ?? {
    pubkey: currentPubkey,
    name: t("system.you"),
    about: "",
    picture: null,
    isAgent: false,
  };
  const nameOf = (channel: BuzzChannel) => channelDisplayName(channel, profiles, currentPubkey);
  const ordered = (section: SidebarSection, items: BuzzChannel[]) =>
    orderSection(
      items,
      organization.order[section],
      (channel) => channel.id,
      (left, right) => nameOf(left).localeCompare(nameOf(right), getLocale()),
    );
  const sections: Record<SidebarSection, BuzzChannel[]> = {
    starred: ordered(
      "starred",
      channels.filter((channel) => starredChannelIds.has(channel.id)),
    ),
    channels: ordered(
      "channels",
      channels.filter((channel) => channel.type === "stream" && !starredChannelIds.has(channel.id)),
    ),
    forums: ordered(
      "forums",
      channels.filter((channel) => channel.type === "forum" && !starredChannelIds.has(channel.id)),
    ),
    dms: ordered(
      "dms",
      channels.filter((channel) => channel.type === "dm" && !starredChannelIds.has(channel.id)),
    ),
  };
  const select = (id: string) => {
    onSelectChannel(id);
    onCloseMobile();
  };
  const featureTools: ToolEntry[] = [
    ...(features.projects
      ? [{ tool: "repos" as const, label: t("nav.projects"), icon: GitBranch }]
      : []),
    ...(tools.pulse
      ? [{ tool: "pulse" as const, label: t("workspace.tool.pulse"), icon: Zap }]
      : []),
    ...(tools.workflows
      ? [{ tool: "workflows" as const, label: t("workspace.tool.workflows"), icon: Workflow }]
      : []),
    { tool: "agents", label: t("agents.title"), icon: Bot },
    ...(tools.remote
      ? [{ tool: "remote" as const, label: t("workspace.tool.remote"), icon: Monitor }]
      : []),
  ];
  const mobileOverflowTools = featureTools.filter((entry) => entry.tool !== "agents");

  useEffect(() => {
    if (!profileMenuOpen && !moreOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!profileMenuRef.current?.contains(target)) setProfileMenuOpen(false);
      if (!moreMenuRef.current?.contains(target)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setMoreOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen, profileMenuOpen]);

  const runProfileAction = (action: () => void) => {
    setProfileMenuOpen(false);
    action();
  };

  const rowsFor = (section: SidebarSection): SidebarRow[] =>
    sections[section].map((channel) => {
      const name = nameOf(channel);
      const unreadCount = channelUnreadCounts[channel.id] ?? 0;
      const other = channel.participantPubkeys.find((value) => value !== currentPubkey);
      const dmProfile = channel.type === "dm" && other ? profiles[other] : null;
      let leading: ReactNode;
      if (dmProfile) {
        leading = (
          <Avatar
            profile={dmProfile}
            relayUrl={relayUrl}
            size={23}
            showStatus
            status={other ? presence[other] : undefined}
          />
        );
      } else {
        const Icon =
          channel.type === "dm"
            ? MessageCircle
            : channel.type === "forum"
              ? MessagesSquare
              : channel.visibility === "private"
                ? Lock
                : Hash;
        leading = <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />;
      }
      return {
        channel,
        name,
        unreadCount,
        selected: activeTool === null && selectedChannelId === channel.id,
        leading,
        trailing: (
          <>
            {section !== "starred" && starredChannelIds.has(channel.id) ? (
              <Star aria-hidden="true" className="h-3 w-3 shrink-0 fill-current text-primary" />
            ) : null}
            {mutedChannelIds.has(channel.id) ? (
              <BellOff aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : null}
            {unreadCount > 0 ? <ChannelUnreadDot channelId={channel.id} /> : null}
          </>
        ),
      };
    });

  const menuItemsFor =
    (section: SidebarSection) =>
    (row: SidebarRow): ContextMenuItem[] => {
      const { channel } = row;
      const ids = sections[section].map((item) => item.id);
      const index = ids.indexOf(channel.id);
      const starred = starredChannelIds.has(channel.id);
      const muted = mutedChannelIds.has(channel.id);
      const items: ContextMenuItem[] = [];
      if (row.unreadCount > 0) {
        items.push({
          id: "read",
          label: t("workspace.sidebar.markRead"),
          icon: MailOpen,
          onSelect: () => channelActions.markRead(channel.id),
        });
      } else if (channelActions.canMarkUnread(channel.id)) {
        items.push({
          id: "unread",
          label: t("workspace.sidebar.markUnread"),
          icon: CircleDot,
          onSelect: () => channelActions.markUnread(channel.id),
        });
      }
      items.push(
        {
          id: "star",
          label: starred ? t("channel.unstar") : t("channel.star"),
          icon: starred ? StarOff : Star,
          onSelect: () => channelActions.toggleStar(channel.id),
        },
        {
          id: "mute",
          label: muted ? t("channel.unmute") : t("channel.mute"),
          icon: muted ? BellRing : BellOff,
          onSelect: () => channelActions.toggleMute(channel.id),
        },
        { kind: "separator", id: "separator-order" },
      );
      if (index > 0) {
        items.push({
          id: "up",
          label: t("workspace.sidebar.moveUp"),
          icon: ArrowUp,
          onSelect: () => move(section, ids, channel.id, -1),
        });
      }
      if (index >= 0 && index < ids.length - 1) {
        items.push({
          id: "down",
          label: t("workspace.sidebar.moveDown"),
          icon: ArrowDown,
          onSelect: () => move(section, ids, channel.id, 1),
        });
      }
      items.push(
        {
          id: "link",
          label: t("workspace.sidebar.copyLink"),
          icon: Link,
          onSelect: () => channelActions.copyLink(channel.id),
        },
        {
          id: "copy-id",
          label: t("workspace.sidebar.copyId"),
          icon: Copy,
          onSelect: () => channelActions.copyId(channel.id),
        },
      );
      if (channel.type !== "dm") {
        items.push({
          id: "details",
          label: t("channel.details"),
          icon: Info,
          onSelect: () => {
            channelActions.openDetails(channel.id);
            onCloseMobile();
          },
        });
      }
      const destructive: ContextMenuItem[] = [];
      if (channel.type === "stream") {
        destructive.push({
          id: "leave",
          label: t("workspace.sidebar.leave"),
          icon: LogOut,
          destructive: true,
          onSelect: () => channelActions.leave(channel),
        });
      }
      if (channel.type !== "dm" && channelActions.canManage(channel)) {
        destructive.push({
          id: "archive",
          label: t("channel.archive"),
          icon: Archive,
          destructive: true,
          onSelect: () => channelActions.archive(channel),
        });
      }
      if (destructive.length)
        items.push({ kind: "separator", id: "separator-leave" }, ...destructive);
      return items;
    };

  const sectionProps = (section: SidebarSection, title: string) => ({
    title,
    collapsed: organization.collapsed[section],
    rows: rowsFor(section),
    menuItemsFor: menuItemsFor(section),
    onToggleCollapsed: () => toggleCollapsed(section),
    onSelect: select,
    onMove: (channelId: string, delta: -1 | 1) => {
      const ids = sections[section].map((item) => item.id);
      return move(section, ids, channelId, delta) ? ids.indexOf(channelId) + delta : null;
    },
  });

  return (
    <>
      <CommunityRail
        connectionDot={<ConnectionDot state={connectionState} />}
        controls={communities}
      />

      {mobileOpen ? (
        <button
          aria-label={t("nav.closeChannels")}
          className="fixed inset-0 z-40 bg-black/35 md:hidden"
          type="button"
          onClick={onCloseMobile}
        />
      ) : null}

      <aside
        className={`relative z-50 flex shrink-0 flex-col overflow-hidden transition-transform max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:!w-[288px] max-md:bg-[linear-gradient(to_bottom,var(--buzz-gradient-top),var(--buzz-gradient-bottom))] ${mobileOpen ? "max-md:translate-x-0 max-md:shadow-2xl" : "max-md:invisible max-md:-translate-x-full"}`}
        style={{ width: panelWidth }}
      >
        <LeftPanelResizeHandle
          label={t("nav.resize")}
          maximum={maximumWidth}
          panelWidth={panelWidth}
          onResize={onResize}
        />

        <header className="flex h-12 shrink-0 items-center gap-1.5 px-2">
          <button
            aria-label={t("common.search")}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-background/35 px-2.5 text-left text-xs text-muted-foreground hover:bg-background/55"
            type="button"
            onClick={onSearch}
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("nav.searchEverything")}</span>
            <kbd className="shrink-0 text-[10px] opacity-65">⌘K</kbd>
          </button>
          {canManageMembers ? (
            <button
              aria-label={t("invite.title")}
              className="buzz-icon-button h-8 w-8 flex-none"
              title={t("invite.title")}
              type="button"
              onClick={onInvite}
            >
              <UserRoundPlus className="h-4 w-4" />
            </button>
          ) : null}
          <button
            aria-label={t("common.close")}
            className="buzz-icon-button md:!hidden"
            type="button"
            onClick={onCloseMobile}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-5">
          <nav aria-label={t("nav.workspace")} className="space-y-0.5">
            <button
              aria-label={t("inbox.title")}
              aria-pressed={activeTool === "inbox"}
              className={`${sidebarRowClass(activeTool === "inbox")} relative`}
              type="button"
              onClick={() => onToggleTool("inbox")}
            >
              <Inbox className="h-[17px] w-[17px] shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("inbox.title")}</span>
              {inboxUnreadCount ? (
                <span
                  className="flex min-h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[10px] font-semibold"
                  data-testid="inbox-unread-count"
                >
                  {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                </span>
              ) : null}
            </button>
            {featureTools.map(({ tool, label, icon: Icon }) => (
              <button
                key={tool}
                aria-label={label}
                aria-pressed={activeTool === tool}
                className={sidebarRowClass(activeTool === tool)}
                type="button"
                onClick={() => onToggleTool(tool)}
              >
                <Icon className="h-[17px] w-[17px] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            ))}
          </nav>

          {sections.starred.length ? (
            <SidebarChannelSection {...sectionProps("starred", t("workspace.sidebar.favorites"))} />
          ) : null}
          <SidebarChannelSection
            {...sectionProps("channels", t("nav.channels"))}
            headerActions={
              <>
                <button
                  aria-label={t("channel.browserTitle")}
                  className="buzz-icon-button h-6 w-6 flex-none"
                  title={t("channel.browserTitle")}
                  type="button"
                  onClick={onBrowseChannels}
                >
                  <Compass className="h-3.5 w-3.5" />
                </button>
                {canCreateChannel ? null : (
                  <span className="sr-only">{t("nav.onlyAdminCreate")}</span>
                )}
              </>
            }
          />
          {features.forum ? (
            <SidebarChannelSection {...sectionProps("forums", t("nav.forums"))} />
          ) : null}
          <SidebarChannelSection
            {...sectionProps("dms", t("nav.directMessages"))}
            headerActions={
              <button
                aria-label={t("nav.newDm")}
                className="buzz-icon-button h-6 w-6 flex-none"
                title={t("nav.newDm")}
                type="button"
                onClick={onNewDm}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            }
          />
        </div>

        <footer className="relative shrink-0 px-2 pb-2" ref={profileMenuRef}>
          {profileMenuOpen ? (
            <div
              aria-label={t("nav.profileMenu")}
              className="buzz-scrollbar absolute bottom-full left-2 right-2 z-50 mb-1 max-h-[70dvh] overflow-y-auto rounded-lg border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl"
              role="menu"
            >
              <CommunityMenuItems controls={communities} onDone={() => setProfileMenuOpen(false)} />
              <div className="my-1 h-px bg-border" />
              {canManageMembers ? (
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6"
                  role="menuitem"
                  type="button"
                  onClick={() => runProfileAction(onInvite)}
                >
                  <UserRoundPlus className="h-4 w-4 text-muted-foreground" />
                  {t("invite.title")}
                </button>
              ) : null}
              <button
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6"
                role="menuitem"
                type="button"
                onClick={() => runProfileAction(onSettings)}
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {t("common.settings")}
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6"
                role="menuitem"
                type="button"
                onClick={() => runProfileAction(onSwitchIdentity)}
              >
                <UserRoundCog className="h-4 w-4 text-muted-foreground" />
                {t("identity.switch")}
              </button>
            </div>
          ) : null}
          <button
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            aria-label={t("nav.profileMenu")}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-foreground/5"
            type="button"
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <Avatar profile={profile} relayUrl={relayUrl} size={27} showStatus status="online" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">{profile.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-muted-foreground">
                <ConnectionDot state={connectionState} />
                <span className="truncate">{communityName}</span>
              </div>
            </div>
            <Ellipsis className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </footer>
      </aside>

      <nav
        aria-label={t("workspace.mobileNavigation")}
        className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t bg-background/95 px-[max(1rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <button
          aria-label={t("inbox.title")}
          aria-pressed={activeTool === "inbox"}
          className="buzz-icon-button relative"
          type="button"
          onClick={() => onToggleTool("inbox")}
        >
          <Inbox className="h-5 w-5" />
          {inboxUnreadCount ? (
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-primary" />
          ) : null}
        </button>
        <button
          aria-label={t("common.messages")}
          aria-pressed={activeTool === null}
          className="buzz-icon-button"
          type="button"
          onClick={onShowMessages}
        >
          <MessagesSquare className="h-5 w-5" />
        </button>
        <button
          aria-label={t("agents.title")}
          aria-pressed={activeTool === "agents"}
          className="buzz-icon-button"
          type="button"
          onClick={() => onToggleTool("agents")}
        >
          <Bot className="h-5 w-5" />
        </button>
        {mobileOverflowTools.length ? (
          <div className="relative" ref={moreMenuRef}>
            <button
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label={t("workspace.moreTools")}
              aria-pressed={mobileOverflowTools.some((entry) => entry.tool === activeTool)}
              className="buzz-icon-button"
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Ellipsis className="h-5 w-5" />
            </button>
            {moreOpen ? (
              <div
                aria-label={t("workspace.moreTools")}
                className="absolute bottom-full left-1/2 mb-2 min-w-48 -translate-x-1/2 rounded-lg border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl"
                role="menu"
              >
                {mobileOverflowTools.map(({ tool, label, icon: Icon }) => (
                  <button
                    key={tool}
                    aria-checked={activeTool === tool}
                    className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-foreground/6 aria-checked:font-semibold"
                    role="menuitemradio"
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onToggleTool(tool);
                    }}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          aria-label={t("common.settings")}
          className="buzz-icon-button"
          type="button"
          onClick={onSettings}
        >
          <Settings className="h-5 w-5" />
        </button>
      </nav>
    </>
  );
}
