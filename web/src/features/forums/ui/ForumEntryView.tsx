import { LoaderCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { useState } from "react";
import { fallbackProfile } from "@/features/chat/lib/chat-model";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { Avatar } from "@/features/chat/ui/Avatar";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import { formatAbsoluteTime, formatRelativeTime } from "@/features/forums/lib/forum-format";
import type { ForumEntry } from "@/features/forums/lib/forum-model";
import { ForumDeleteDialog } from "@/features/forums/ui/ForumDeleteDialog";
import { t } from "@/shared/i18n";

export function profileFor(profiles: Record<string, UserProfile>, pubkey: string): UserProfile {
  return profiles[pubkey] ?? profiles[pubkey.toLowerCase()] ?? fallbackProfile(pubkey);
}

export function entryMentions(
  entry: ForumEntry,
  profiles: Record<string, UserProfile>,
): MessageMention[] {
  return entry.mentionPubkeys.flatMap((pubkey) => {
    const profile = profiles[pubkey];
    return profile?.name ? [{ pubkey, name: profile.name, isAgent: profile.isAgent }] : [];
  });
}

function EditForm({
  initial,
  label,
  onCancel,
  onSave,
}: {
  initial: string;
  label: string;
  onCancel: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = !content.trim() || content === initial;
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged || saving) return;
        setSaving(true);
        setError(null);
        void onSave(content)
          .then(onCancel)
          .catch((saveError: unknown) => {
            setError(
              saveError instanceof Error ? saveError.message : t("collab.forums.error.edit"),
            );
            setSaving(false);
          });
      }}
    >
      <textarea
        aria-label={label}
        // biome-ignore lint/a11y/noAutofocus: the user explicitly asked to edit this entry.
        autoFocus
        className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-primary/30"
        maxLength={65_536}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          className="h-8 rounded-md px-3 text-sm hover:bg-foreground/5"
          type="button"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
        <button
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          disabled={unchanged || saving}
          type="submit"
        >
          {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

/** Author line, actions, Markdown body and inline edit for a forum post or reply. */
export function ForumEntryView({
  entry,
  kind,
  profiles,
  relayUrl,
  now,
  canEdit,
  canDelete,
  onReply,
  onEdit,
  onDelete,
  body,
}: {
  entry: ForumEntry;
  kind: "post" | "reply";
  profiles: Record<string, UserProfile>;
  relayUrl: string;
  now: number;
  canEdit: boolean;
  canDelete: boolean;
  onReply?: () => void;
  onEdit: (content: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Content shown instead of the full entry content (e.g. a post body under its title). */
  body?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const author = profileFor(profiles, entry.event.pubkey);
  const isPost = kind === "post";
  const editLabel = t(isPost ? "collab.forums.editPost" : "collab.forums.editReply");
  const deleteLabel = t(isPost ? "collab.forums.deletePost" : "collab.forums.deleteReply");
  const shownContent = body ?? entry.content;
  return (
    <div className="group/entry min-w-0" data-forum-event-id={entry.event.id}>
      <div className="flex min-w-0 items-center gap-2">
        <Avatar profile={author} relayUrl={relayUrl} size={isPost ? 32 : 26} />
        <span className="min-w-0 truncate text-sm font-medium">{author.name}</span>
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={new Date(entry.event.created_at * 1_000).toISOString()}
          title={formatAbsoluteTime(entry.event.created_at)}
        >
          {formatRelativeTime(entry.event.created_at, now)}
        </time>
        {entry.edited ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("collab.forums.edited")}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {onReply ? (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              type="button"
              onClick={onReply}
            >
              <Reply aria-hidden="true" className="h-3.5 w-3.5" />
              {t("collab.forums.reply")}
            </button>
          ) : null}
          {canEdit && !editing ? (
            <button
              aria-label={editLabel}
              className="buzz-icon-button"
              title={editLabel}
              type="button"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {canDelete ? (
            <button
              aria-label={deleteLabel}
              className="buzz-icon-button hover:!text-destructive"
              title={deleteLabel}
              type="button"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <EditForm
          initial={entry.content}
          label={editLabel}
          onCancel={() => setEditing(false)}
          onSave={onEdit}
        />
      ) : shownContent.trim() ? (
        <div className={isPost ? "mt-3 text-sm" : "mt-1 pl-[34px] text-sm"}>
          <MessageContent
            content={shownContent}
            mediaTags={entry.event.tags}
            mentions={entryMentions(entry, profiles)}
            relayUrl={relayUrl}
          />
        </div>
      ) : null}
      {confirmingDelete ? (
        <ForumDeleteDialog
          kind={kind}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={onDelete}
        />
      ) : null}
    </div>
  );
}
