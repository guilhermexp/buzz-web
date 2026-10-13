import { CheckCheck, ExternalLink, LoaderCircle, Mail, RotateCcw, ShieldAlert } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import { Avatar } from "@/features/chat/ui/Avatar";
import {
  INBOX_GROUPS,
  type InboxCategory,
  type InboxItem,
  inboxPreview,
} from "@/features/inbox/lib/inbox-model";
import { getLocale, t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

export type InboxFilter = "all" | InboxCategory;

export function categoryLabel(category: InboxCategory): string {
  if (category === "dm") return t("inbox.directMessage");
  if (category === "thread") return t("inbox.threadReply");
  if (category === "needs_action") return t("inbox.needsAction");
  return t("inbox.mention");
}

function groupTitle(category: InboxCategory): string {
  if (category === "dm") return t("inbox.directMessages");
  if (category === "thread") return t("inbox.threadReplies");
  if (category === "needs_action") return t("inbox.needsAction");
  return t("inbox.mentions");
}

function relativeTime(createdAt: number): string {
  const seconds = createdAt - Math.floor(Date.now() / 1_000);
  const formatter = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function inboxProfile(
  profiles: Readonly<Record<string, UserProfile>>,
  item: InboxItem,
): UserProfile {
  return (
    profiles[item.event.pubkey.toLowerCase()] ?? {
      pubkey: item.event.pubkey,
      name: truncatePubkey(item.event.pubkey),
      about: "",
      picture: null,
      isAgent: false,
    }
  );
}

/** Relay errors that mean the identity may not read the Inbox sources. */
export function isAccessDenied(error: string): boolean {
  return /\b(restricted|auth-required|forbidden|not a member|unauthorized)\b/i.test(error);
}

/**
 * Inbox rows grouped as on desktop (Needs action, Mentions, Threads, DMs).
 * Arrow keys/Home/End move between rows; each row offers read-state and
 * open-source actions without nesting interactive elements.
 */
export function InboxList({
  items,
  filter,
  channels,
  profiles,
  relayUrl,
  selectedId,
  loading,
  error,
  unreadOnly,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onOpenSource,
  onRetry,
}: {
  items: readonly InboxItem[];
  filter: InboxFilter;
  channels: readonly BuzzChannel[];
  profiles: Readonly<Record<string, UserProfile>>;
  relayUrl: string;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  unreadOnly: boolean;
  onSelect: (item: InboxItem) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onOpenSource: (item: InboxItem) => void;
  onRetry: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const groups =
    filter === "all"
      ? INBOX_GROUPS.map((category) => ({
          category,
          items: items.filter((item) => item.category === category),
        })).filter((group) => group.items.length)
      : [{ category: filter, items }];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? [])];
    if (!rows.length) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), rows.length - 1);
    rows[next]?.focus();
  };

  if (error && !items.length) {
    const denied = isAccessDenied(error);
    return (
      <div className="px-5 py-14 text-center" role="alert">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">
          {denied ? t("workspace.inbox.deniedTitle") : t("workspace.inbox.errorTitle")}
        </p>
        <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
        <button
          className="mt-4 h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5"
          type="button"
          onClick={onRetry}
        >
          {t("common.refresh")}
        </button>
      </div>
    );
  }
  if (loading && !items.length) {
    return (
      <div className="flex items-center justify-center px-5 py-14 text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        {t("inbox.loading")}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="px-5 py-14 text-center">
        <Mail className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">
          {unreadOnly ? t("workspace.inbox.emptyUnread") : t("inbox.empty")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {unreadOnly
            ? t("workspace.inbox.emptyUnreadHint")
            : filter === "all"
              ? t("workspace.inbox.emptyHint")
              : t("workspace.inbox.emptyFilterHint")}
        </p>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow-key roving between row buttons
    <div ref={listRef} onKeyDown={onKeyDown}>
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`inbox-group-${group.category}`}>
          {filter === "all" ? (
            <h3
              className="sticky top-0 z-10 flex h-8 items-center justify-between border-b bg-background/95 px-3 text-[11px] font-medium text-muted-foreground backdrop-blur"
              id={`inbox-group-${group.category}`}
            >
              <span>{groupTitle(group.category)}</span>
              <span className="tabular-nums">{group.items.length}</span>
            </h3>
          ) : (
            <h3 className="sr-only" id={`inbox-group-${group.category}`}>
              {groupTitle(group.category)}
            </h3>
          )}
          <ul>
            {group.items.map((item) => {
              const profile = inboxProfile(profiles, item);
              const channel = item.channelId
                ? channels.find((candidate) => candidate.id === item.channelId)
                : null;
              const isSelected = selectedId === item.id;
              return (
                <li key={item.id} className="group/inbox relative border-b">
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex min-h-[84px] w-full gap-3 px-3 py-3 text-left outline-none transition-colors focus-visible:bg-foreground/[0.07] ${
                      isSelected ? "bg-foreground/[0.055]" : "hover:bg-foreground/[0.035]"
                    }`}
                    data-inbox-row=""
                    type="button"
                    onClick={() => onSelect(item)}
                  >
                    <Avatar profile={profile} relayUrl={relayUrl} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {profile.name}
                        </span>
                        {item.unread ? (
                          <span
                            aria-label={t("inbox.unread")}
                            className="h-2 w-2 shrink-0 rounded-full bg-primary"
                            role="img"
                          />
                        ) : null}
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {relativeTime(item.event.created_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{categoryLabel(item.category)}</span>
                        {channel ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">
                              {channel.type === "dm" ? profile.name : `#${channel.name}`}
                            </span>
                          </>
                        ) : null}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-foreground/90">
                        {item.approval?.summary ??
                          (inboxPreview(item.event) || t("inbox.noDetails"))}
                      </p>
                    </div>
                  </button>
                  <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover/inbox:opacity-100 max-md:hidden">
                    <button
                      aria-label={item.unread ? t("inbox.markRead") : t("inbox.markUnread")}
                      className="buzz-icon-button h-7 w-7 flex-none"
                      title={item.unread ? t("inbox.markRead") : t("inbox.markUnread")}
                      type="button"
                      onClick={() => (item.unread ? onMarkRead(item.id) : onMarkUnread(item.id))}
                    >
                      {item.unread ? (
                        <CheckCheck className="h-3.5 w-3.5" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      aria-label={t("inbox.openInChat")}
                      className="buzz-icon-button h-7 w-7 flex-none"
                      disabled={!item.channelId}
                      title={t("inbox.openInChat")}
                      type="button"
                      onClick={() => onOpenSource(item)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
