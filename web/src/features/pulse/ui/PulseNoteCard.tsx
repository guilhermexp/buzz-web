import { useQuery } from "@tanstack/react-query";
import { Heart, Loader2, MessageCircle, MessagesSquare, SquareArrowOutUpRight } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/features/chat/ui/Avatar";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { getReplyParent } from "@/features/pulse/lib/pulse-events";
import { fetchNote } from "@/features/pulse/lib/pulse-queries";
import type { Likes } from "@/features/pulse/lib/use-pulse";
import { PulseComposer } from "@/features/pulse/ui/PulseComposer";
import { usePulseSession } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";

const ACTION =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45";

export function usePulseNote(noteId: string | null) {
  const { client, relayUrl, me } = usePulseSession();
  return useQuery({
    queryKey: ["pulse-note", relayUrl, me, noteId],
    queryFn: () => fetchNote(client, noteId ?? ""),
    enabled: Boolean(noteId),
    staleTime: 5 * 60_000,
  });
}

function ReplyContext({ parentId }: { parentId: string }) {
  const { profile, openThread } = usePulseSession();
  const parent = usePulseNote(parentId);
  const note = parent.data ?? null;
  return (
    <button
      className="mt-2 block w-full min-w-0 truncate rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      type="button"
      onClick={() => openThread(parentId)}
    >
      {note ? (
        <>
          <span className="font-medium text-foreground/80">
            {t("collab.pulse.replyingTo", { name: profile(note.pubkey).name })}
          </span>
          {": "}
          {note.content.trim().replace(/\s+/g, " ").slice(0, 120) || t("collab.pulse.noText")}
        </>
      ) : parent.isLoading ? (
        t("collab.pulse.replyLoading")
      ) : (
        t("collab.pulse.replyUnavailable")
      )}
    </button>
  );
}

export function PulseNoteCard({
  note,
  likes,
  showReplyContext = true,
  onReplied,
}: {
  note: NostrEvent;
  likes: Likes;
  showReplyContext?: boolean;
  onReplied?: (reply: NostrEvent) => void;
}) {
  const { relayUrl, profile, isAgent, openProfile, openThread } = usePulseSession();
  const [replying, setReplying] = useState(false);
  const author = profile(note.pubkey);
  const agent = isAgent(note.pubkey);
  const mentions = note.tags
    .filter((tag) => tag[0] === "p" && tag[1])
    .map((tag) => ({ pubkey: tag[1], name: profile(tag[1]).name, isAgent: isAgent(tag[1]) }));
  const { count, myReactionId } = likes.summary(note.id);
  const liked = myReactionId !== null;
  const likePending = likes.pendingIds.has(note.id);
  const parentId = showReplyContext ? getReplyParent(note) : null;
  const createdAt = new Date(note.created_at * 1000);

  const toggleLike = () => {
    likes.toggle(note).catch((error: unknown) =>
      toast.error(t("collab.pulse.error.like"), {
        description: error instanceof Error ? error.message.slice(0, 200) : undefined,
      }),
    );
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        `nostr:${nip19.neventEncode({ id: note.id, author: note.pubkey })}`,
      );
      toast.success(t("collab.pulse.shareCopied"));
    } catch {
      toast.error(t("collab.pulse.shareFailed"));
    }
  };

  return (
    <article
      aria-label={author.name}
      className="flex items-start gap-3 border-b border-border/50 px-1 py-4 last:border-b-0 sm:px-2"
      data-note-id={note.id}
    >
      <button
        aria-hidden
        className="shrink-0 rounded-full"
        tabIndex={-1}
        type="button"
        onClick={() => openProfile(note.pubkey)}
      >
        <Avatar profile={{ ...author, isAgent: agent }} relayUrl={relayUrl} size={36} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <button
            className="max-w-full truncate rounded text-sm font-semibold tracking-tight hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={() => openProfile(note.pubkey)}
          >
            {author.name}
          </button>
          {agent ? (
            <span className="inline-flex h-4 items-center rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
              {t("collab.pulse.bot")}
            </span>
          ) : null}
          <time
            className="shrink-0 text-xs text-muted-foreground"
            dateTime={createdAt.toISOString()}
            title={createdAt.toLocaleString()}
          >
            {relativeTime(note.created_at)}
          </time>
        </div>
        {parentId ? <ReplyContext parentId={parentId} /> : null}
        <div className="mt-1 min-w-0 break-words text-sm">
          <MessageContent
            content={note.content}
            mediaTags={note.tags}
            mentions={mentions}
            relayUrl={relayUrl}
          />
        </div>
        <div className="-ml-1.5 mt-1.5 flex flex-wrap items-center gap-1 text-xs font-medium">
          <button
            aria-label={liked ? t("collab.pulse.action.unlike") : t("collab.pulse.action.like")}
            aria-pressed={liked}
            className={`${ACTION} ${liked ? "text-primary" : ""}`}
            disabled={likePending}
            title={liked ? t("collab.pulse.action.unlike") : t("collab.pulse.action.like")}
            type="button"
            onClick={toggleLike}
          >
            {likePending ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Heart aria-hidden className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />
            )}
            {count > 0 ? (
              <span
                className="tabular-nums"
                data-testid="pulse-like-count"
                title={t("collab.pulse.likeCount", { count })}
              >
                {count}
              </span>
            ) : null}
          </button>
          <button
            aria-expanded={replying}
            aria-label={t("collab.pulse.action.reply")}
            className={ACTION}
            title={t("collab.pulse.action.reply")}
            type="button"
            onClick={() => setReplying((value) => !value)}
          >
            <MessageCircle aria-hidden className="h-4 w-4" />
          </button>
          <button
            aria-label={t("collab.pulse.action.openThread")}
            className={ACTION}
            title={t("collab.pulse.action.openThread")}
            type="button"
            onClick={() => openThread(note.id)}
          >
            <MessagesSquare aria-hidden className="h-4 w-4" />
          </button>
          <button
            aria-label={t("collab.pulse.action.share")}
            className={ACTION}
            title={t("collab.pulse.action.share")}
            type="button"
            onClick={() => void share()}
          >
            <SquareArrowOutUpRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
        {replying ? (
          <PulseComposer
            autoFocus
            parent={note}
            onCancel={() => setReplying(false)}
            onPosted={(reply) => {
              setReplying(false);
              onReplied?.(reply);
            }}
          />
        ) : null}
      </div>
    </article>
  );
}
