import { LoaderCircle, MessageSquare, MessagesSquare, Plus, RotateCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { Avatar } from "@/features/chat/ui/Avatar";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  formatReplyCount,
} from "@/features/forums/lib/forum-format";
import type { ForumSort, ForumTopic } from "@/features/forums/lib/forum-model";
import { profileFor } from "@/features/forums/ui/ForumEntryView";
import { t } from "@/shared/i18n";

const SORTS: {
  value: ForumSort;
  label: "collab.forums.sortActivity" | "collab.forums.sortNewest";
}[] = [
  { value: "activity", label: "collab.forums.sortActivity" },
  { value: "newest", label: "collab.forums.sortNewest" },
];

function TopicRow({
  topic,
  profiles,
  relayUrl,
  now,
  onOpen,
}: {
  topic: ForumTopic;
  profiles: Record<string, UserProfile>;
  relayUrl: string;
  now: number;
  onOpen: () => void;
}) {
  const author = profileFor(profiles, topic.event.pubkey);
  return (
    <li
      className="relative flex gap-3 px-3 py-3 transition-colors hover:bg-foreground/[0.03] focus-within:bg-foreground/[0.03] sm:px-4"
      data-forum-topic-id={topic.event.id}
      data-unread={topic.unread || undefined}
    >
      <Avatar profile={author} relayUrl={relayUrl} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <h3
            className={`min-w-0 flex-1 text-sm leading-5 break-words ${topic.unread ? "font-semibold" : "font-medium"}`}
          >
            <button
              className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-primary/40 focus-visible:after:ring-inset"
              type="button"
              onClick={onOpen}
            >
              {topic.title || t("collab.forums.untitled")}
            </button>
          </h3>
          {topic.unread ? (
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-primary">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
              {t("collab.forums.unread")}
            </span>
          ) : null}
        </div>
        {topic.excerpt ? (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 break-words text-muted-foreground">
            {topic.excerpt}
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="max-w-48 truncate font-medium text-foreground/80">{author.name}</span>
          <time
            dateTime={new Date(topic.event.created_at * 1_000).toISOString()}
            title={formatAbsoluteTime(topic.event.created_at)}
          >
            {formatRelativeTime(topic.event.created_at, now)}
          </time>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1" data-testid="forum-reply-count">
            <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
            {formatReplyCount(topic.replyCount)}
          </span>
          {topic.lastReplyAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span title={formatAbsoluteTime(topic.lastActivity)}>
                {t("collab.forums.lastActivity", {
                  time: formatRelativeTime(topic.lastActivity, now),
                })}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TopicSkeleton() {
  return (
    <ul aria-hidden="true" className="divide-y">
      {[0, 1, 2].map((index) => (
        <li key={index} className="flex gap-3 px-4 py-3">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-foreground/8" />
          <span className="flex-1 space-y-2">
            <span className="block h-4 w-2/3 animate-pulse rounded bg-foreground/8" />
            <span className="block h-3 w-full animate-pulse rounded bg-foreground/6" />
            <span className="block h-3 w-1/3 animate-pulse rounded bg-foreground/6" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ForumTopicList({
  topics,
  status,
  loadError,
  hasMore,
  loadingMore,
  sort,
  canPost,
  composing,
  blockedReason,
  profiles,
  relayUrl,
  now,
  newPostForm,
  onSortChange,
  onNewPost,
  onOpen,
  onRetry,
  onLoadMore,
}: {
  topics: ForumTopic[];
  status: "loading" | "ready" | "error";
  loadError: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  sort: ForumSort;
  canPost: boolean;
  composing: boolean;
  blockedReason: string | null;
  profiles: Record<string, UserProfile>;
  relayUrl: string;
  now: number;
  newPostForm: ReactNode;
  onSortChange: (sort: ForumSort) => void;
  onNewPost: () => void;
  onOpen: (postId: string) => void;
  onRetry: () => void;
  onLoadMore: () => Promise<void>;
}) {
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b">
        <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
          {canPost && !composing ? (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              type="button"
              onClick={onNewPost}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("collab.forums.newPost")}
            </button>
          ) : null}
          {blockedReason ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}
          <fieldset className="ml-auto inline-flex rounded-md border p-0.5">
            <legend className="sr-only">{t("collab.forums.sortLabel")}</legend>
            {SORTS.map((option) => (
              <button
                key={option.value}
                aria-pressed={sort === option.value}
                className="h-7 rounded px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-foreground/8 aria-pressed:font-medium aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                type="button"
                onClick={() => onSortChange(option.value)}
              >
                {t(option.label)}
              </button>
            ))}
          </fieldset>
        </div>
      </div>
      {composing ? newPostForm : null}
      <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px]">
          {status === "loading" && !topics.length ? (
            <TopicSkeleton />
          ) : status === "error" && !topics.length ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center" role="alert">
              <p className="max-w-md text-sm text-destructive">{loadError}</p>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-foreground/5"
                type="button"
                onClick={onRetry}
              >
                <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("collab.forums.retry")}
              </button>
            </div>
          ) : !topics.length ? (
            <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
              <MessagesSquare aria-hidden="true" className="h-9 w-9 text-muted-foreground/50" />
              <p className="text-sm font-medium">{t("collab.forums.emptyTitle")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t(canPost ? "collab.forums.emptyHint" : "collab.forums.emptyReadOnly")}
              </p>
            </div>
          ) : (
            <ul aria-label={t("collab.forums.topicsLabel")} className="divide-y">
              {topics.map((topic) => (
                <TopicRow
                  key={topic.event.id}
                  now={now}
                  profiles={profiles}
                  relayUrl={relayUrl}
                  topic={topic}
                  onOpen={() => onOpen(topic.event.id)}
                />
              ))}
            </ul>
          )}
          {hasMore && topics.length ? (
            <div className="flex flex-col items-center gap-2 px-4 py-4">
              {loadMoreError ? (
                <p className="text-xs text-destructive" role="alert">
                  {loadMoreError}
                </p>
              ) : null}
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-foreground/5 disabled:opacity-50"
                disabled={loadingMore}
                type="button"
                onClick={() => {
                  setLoadMoreError(null);
                  onLoadMore().catch((error: unknown) =>
                    setLoadMoreError(
                      error instanceof Error ? error.message : t("collab.forums.error.load"),
                    ),
                  );
                }}
              >
                {loadingMore ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                {t("collab.forums.loadOlder")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
