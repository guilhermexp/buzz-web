import {
  Compass,
  CornerDownRight,
  Hash,
  LoaderCircle,
  Lock,
  MessageCircle,
  MessagesSquare,
  Plus,
  Search,
  X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { channelDisplayName, threadReference } from "@/features/chat/lib/chat-model";
import type { BuzzChannel, SearchHit, UserProfile } from "@/features/chat/lib/chat-types";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { getLocale, t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

type SearchRow =
  | { kind: "channel"; key: string; channel: BuzzChannel }
  | { kind: "message"; key: string; hit: SearchHit };

const SECTION_TITLE = "px-2.5 pb-1.5 pt-2 text-xs font-medium text-muted-foreground/80";

function ChannelIcon({ channel }: { channel: BuzzChannel | undefined }) {
  const Icon =
    channel?.type === "dm"
      ? MessageCircle
      : channel?.type === "forum"
        ? MessagesSquare
        : channel?.visibility === "private"
          ? Lock
          : Hash;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

/** Search across the Relay (or one channel) with keyboard-navigable results. */
export function SearchDialog({
  channels,
  profiles,
  currentPubkey,
  onClose,
  onSearch,
  onSelect,
  onSelectChannel,
  onBrowseChannels,
  onCreateChannel,
  onNewDm,
  scopeChannel = null,
}: {
  channels: BuzzChannel[];
  profiles: Record<string, UserProfile>;
  currentPubkey: string;
  onClose: () => void;
  onSearch: (term: string, channelId?: string) => Promise<SearchHit[]>;
  /** Opens the exact source event, including its thread when it is a reply. */
  onSelect: (hit: SearchHit, threadRootId: string | null) => void;
  onSelectChannel: (channelId: string) => void;
  onBrowseChannels: () => void;
  onCreateChannel?: () => void;
  onNewDm?: () => void;
  scopeChannel?: BuzzChannel | null;
}) {
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState(scopeChannel);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = term.trim();
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(false);
    setActiveIndex(0);
    if (query.length < 2) {
      setResults([]);
      return () => {
        active = false;
      };
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void onSearch(query, scope?.id)
        .then((nextResults) => {
          if (active) setResults(nextResults);
        })
        .catch(() => {
          if (active) {
            setResults([]);
            setError(t("error.messageSearch"));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onSearch, query, scope?.id]);

  const visibleChannels = channels.filter((channel) => channel.isMember && !channel.archived);
  const lowerQuery = query.toLocaleLowerCase(getLocale());
  const channelRows: SearchRow[] = scope
    ? []
    : (query
        ? visibleChannels.filter((channel) =>
            channelDisplayName(channel, profiles, currentPubkey)
              .toLocaleLowerCase(getLocale())
              .includes(lowerQuery),
          )
        : visibleChannels
      )
        .slice(0, query ? 6 : 10)
        .map((channel) => ({ kind: "channel", key: `channel:${channel.id}`, channel }));
  // Results belong to the last query; hide them as soon as the query is too short.
  const messageRows: SearchRow[] = (query.length >= 2 ? results : []).map((hit) => ({
    kind: "message",
    key: `message:${hit.event.id}`,
    hit,
  }));
  const rows = [...channelRows, ...messageRows];
  const clampedIndex = Math.min(activeIndex, Math.max(rows.length - 1, 0));
  const activeRow = rows[clampedIndex];

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-search-result-index="${clampedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  const activate = (row: SearchRow) => {
    onClose();
    if (row.kind === "channel") onSelectChannel(row.channel.id);
    else onSelect(row.hit, threadReference(row.hit.event).rootId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(Math.min(Math.max(clampedIndex + step, 0), rows.length - 1));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && activeRow) {
      event.preventDefault();
      activate(activeRow);
    } else if (event.key === "Backspace" && !term && scope) {
      event.preventDefault();
      setScope(null);
    }
  };

  const renderRow = (row: SearchRow, index: number): ReactNode => {
    const active = index === clampedIndex;
    const common = {
      "aria-selected": active,
      className: `w-full cursor-pointer rounded-md px-2.5 text-left ${active ? "bg-foreground/8" : ""}`,
      "data-search-result-index": index,
      id: `search-row-${index}`,
      role: "option" as const,
      onClick: () => activate(row),
      onMouseMove: () => setActiveIndex(index),
    };
    if (row.kind === "channel") {
      const name = channelDisplayName(row.channel, profiles, currentPubkey);
      return (
        <div
          key={row.key}
          {...common}
          className={`${common.className} flex h-9 items-center gap-2`}
        >
          <ChannelIcon channel={row.channel} />
          <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
          {row.channel.description ? (
            <span className="max-w-[45%] truncate text-xs text-muted-foreground">
              {row.channel.description}
            </span>
          ) : null}
        </div>
      );
    }
    const { hit } = row;
    const channel = channelById.get(hit.channelId);
    const profile = profiles[hit.event.pubkey.toLowerCase()];
    const inThread = threadReference(hit.event).rootId !== null;
    return (
      <div key={row.key} {...common} className={`${common.className} py-2`}>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ChannelIcon channel={channel} />
          <span className="min-w-0 truncate font-medium text-foreground/80">
            {channel
              ? channel.type === "dm"
                ? t("workspace.search.directMessage")
                : channelDisplayName(channel, profiles, currentPubkey)
              : t("common.channel")}
          </span>
          {inThread ? (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <CornerDownRight aria-hidden="true" className="h-3 w-3" />
              {t("workspace.search.inThread")}
            </span>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">
            {profile?.name ?? truncatePubkey(hit.event.pubkey)}
          </span>
          <time
            className="ml-auto shrink-0 tabular-nums"
            dateTime={new Date(hit.event.created_at * 1_000).toISOString()}
          >
            {new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium" }).format(
              hit.event.created_at * 1_000,
            )}
          </time>
        </div>
        <p className="mt-1 line-clamp-2 break-words text-sm leading-5">{hit.event.content}</p>
      </div>
    );
  };

  const title = scope
    ? t("dialog.searchChannel", { channel: scope.name })
    : t("dialog.searchMessages");
  const actionClass =
    "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium hover:bg-foreground/6";
  return (
    <DialogFrame title={title} width="max-w-2xl" onClose={onClose}>
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        {scope ? (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-foreground/7 pl-2 pr-1 text-xs">
            <ChannelIcon channel={scope} />
            <span className="max-w-32 truncate">{scope.name}</span>
            <button
              aria-label={t("workspace.search.clearScope")}
              className="rounded p-0.5 hover:bg-foreground/10"
              title={t("workspace.search.clearScope")}
              type="button"
              onClick={() => {
                setScope(null);
                inputRef.current?.focus();
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : null}
        <input
          ref={inputRef}
          aria-activedescendant={activeRow ? `search-row-${clampedIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls="workspace-search-results"
          aria-expanded={rows.length > 0}
          aria-label={title}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder={scope ? t("dialog.searchChannelPlaceholder") : t("dialog.searchRelay")}
          role="combobox"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      {!query && !scope ? (
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
          <button
            className={actionClass}
            type="button"
            onClick={() => {
              onClose();
              onBrowseChannels();
            }}
          >
            <Compass className="h-4 w-4 text-muted-foreground" />
            {t("channel.browserTitle")}
          </button>
          {onCreateChannel ? (
            <button
              className={actionClass}
              type="button"
              onClick={() => {
                onClose();
                onCreateChannel();
              }}
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              {t("dialog.createChannel")}
            </button>
          ) : null}
          {onNewDm ? (
            <button
              className={actionClass}
              type="button"
              onClick={() => {
                onClose();
                onNewDm();
              }}
            >
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              {t("workspace.tool.new-dm")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={listRef}
        aria-label={title}
        className="buzz-scrollbar max-h-[60dvh] overflow-y-auto p-2"
        id="workspace-search-results"
        role="listbox"
      >
        {channelRows.length ? (
          <div role="presentation">
            <div className={SECTION_TITLE} role="presentation">
              {query ? t("workspace.search.channels") : t("workspace.search.recent")}
            </div>
            {channelRows.map((row, index) => renderRow(row, index))}
          </div>
        ) : null}
        {messageRows.length ? (
          <div role="presentation">
            <div className={SECTION_TITLE} role="presentation">
              {t("workspace.search.messages")}
            </div>
            {messageRows.map((row, index) => renderRow(row, channelRows.length + index))}
          </div>
        ) : null}
        {error ? (
          <p className="px-3 py-10 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {query.length >= 2 && !loading && !error && !results.length ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {t("dialog.noMessages")}
          </p>
        ) : null}
        {query.length > 0 && query.length < 2 && !channelRows.length ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {t("workspace.search.keepTyping")}
          </p>
        ) : null}
      </div>
    </DialogFrame>
  );
}
